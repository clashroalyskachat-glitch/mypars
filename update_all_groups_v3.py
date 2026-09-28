import json
import os
import re
import sys
import time
import threading
import http.client
import concurrent.futures
from html.parser import HTMLParser

sys.stdout.reconfigure(encoding="utf-8")

HOST = "do.nkse.ru"
PORT = 80
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_pagecache")
META_PATH = os.path.join(CACHE_DIR, "meta.json")
MAX_WORKERS = 6          # be polite to a small college server
PER_REQUEST_TIMEOUT = 10
DEADLINE_SECONDS = 180


# ---------------------------------------------------------------- HTML parsing
class DetailedTableParser(HTMLParser):
    """Parses the table and also records row/td class names, which is how the
    source marks substituted lessons (background-color: LightGreen)."""

    def __init__(self):
        super().__init__()
        self.rows = []
        self.current_row = []
        self.in_cell = False
        self.cell_content = []
        self.tr_class = ""
        self.cell_class = ""
        self.cell_keys = {}

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == 'tr':
            self.current_row = []
            self.tr_class = ""
            for k, v in attrs:
                if k.lower() == 'class':
                    self.tr_class = v or ""
        elif tag in ('td', 'th'):
            self.in_cell = True
            self.cell_content = []
            self.cell_class = ""
            for k, v in attrs:
                if k.lower() == 'class':
                    self.cell_class = v or ""

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag == 'tr':
            self.rows.append(self.current_row)
        elif tag in ('td', 'th'):
            self.in_cell = False
            text = "".join(self.cell_content).strip()
            self.cell_keys[(len(self.rows), len(self.current_row))] = (self.tr_class, self.cell_class)
            self.current_row.append(text)

    def handle_data(self, data):
        if self.in_cell:
            self.cell_content.append(data)


def parse_green_cells(html):
    green = set()
    for m in re.finditer(r"tr\.(\S+)\s+td\.(\S+)\s*\{([^}]*)\}", html):
        if 'lightgreen' in m.group(3).lower():
            green.add((m.group(1), m.group(2)))
    return green


GROUP_RE = re.compile(r'^[А-ЯЁA-Z]+-\d+-\d+$')
OFFSETS_SUBJECT = [1, 5, 9, 13, 17, 21]
OFFSETS_TIME = [3, 7, 11, 15, 19, 23]


def parse_page(html, day_name):
    """Turn one schedule page into {group: {day: [lessons]}}."""
    green = parse_green_cells(html)
    p = DetailedTableParser()
    p.feed(html)
    table = p.rows
    if not table:
        return {}

    def substituted(row_idx, col_idx):
        key = p.cell_keys.get((row_idx, col_idx))
        if not key:
            return False
        tr_class, td_class = key
        if not td_class:
            return False
        if (tr_class, td_class) in green:
            return True
        return any(td == td_class for (tr, td) in green)

    out = {}
    for r_i, row in enumerate(table):
        for c_i, cell in enumerate(row):
            cleaned = cell.strip()
            if not GROUP_RE.match(cleaned) or not (3 <= len(cleaned) <= 15):
                continue
            group = cleaned
            lessons = []
            for i in range(len(OFFSETS_SUBJECT)):
                s_idx = r_i + OFFSETS_SUBJECT[i]
                t_idx = r_i + OFFSETS_TIME[i]
                if s_idx >= len(table) or len(table[s_idx]) <= c_i:
                    continue
                subject = table[s_idx][c_i].strip()
                if not subject or subject == group:
                    continue
                time_str = table[t_idx][0].strip() if t_idx < len(table) and len(table[t_idx]) > 0 else ""
                teachers, rooms = [], []
                t1, r1 = 2 * c_i - 1, 2 * c_i
                if t_idx < len(table):
                    if t1 < len(table[t_idx]):
                        v = table[t_idx][t1].strip()
                        if v and not re.search(r'\d{1,2}:\d{2}', v) and v != subject and v not in teachers:
                            teachers.append(v)
                    if r1 < len(table[t_idx]):
                        v = table[t_idx][r1].strip()
                        if v and not re.search(r'\d{1,2}:\d{2}', v) and v != subject and v not in rooms:
                            rooms.append(v)
                t2, r2 = 2 * c_i - 2, 2 * c_i - 1
                if t_idx + 1 < len(table):
                    if t2 < len(table[t_idx + 1]):
                        v = table[t_idx + 1][t2].strip()
                        if v and not re.search(r'\d{1,2}:\d{2}', v) and v != subject and v not in teachers:
                            teachers.append(v)
                    if r2 < len(table[t_idx + 1]):
                        v = table[t_idx + 1][r2].strip()
                        if v and not re.search(r'\d{1,2}:\d{2}', v) and v != subject and v not in rooms:
                            rooms.append(v)
                subgroups = []
                for j in range(max(len(teachers), len(rooms), 1)):
                    t = teachers[j] if j < len(teachers) else (teachers[0] if teachers else "")
                    r = rooms[j] if j < len(rooms) else (rooms[0] if rooms else "")
                    subgroups.append({"teacher": t, "room": r})
                lesson = {
                    "number": str(i + 1),
                    "time": time_str,
                    "subject": subject,
                    "teacher": ", ".join(teachers),
                    "room": ", ".join(rooms),
                    "subgroups": subgroups,
                }
                if substituted(s_idx, c_i):
                    lesson["substituted"] = True
                lessons.append(lesson)
            if lessons:
                out[group] = {day_name: lessons}
    return out


# ------------------------------------------------------------------ http layer
class Fetcher:
    """Keep-alive HTTP client with conditional-GET support.

    One persistent connection per worker thread. Conditional headers let the
    server answer 304 when a page is unchanged, so we skip both the download
    and the parse for that page.
    """

    def __init__(self):
        self._local = threading.local()

    def _conn(self):
        c = getattr(self._local, "conn", None)
        if c is None:
            c = http.client.HTTPConnection(HOST, PORT, timeout=PER_REQUEST_TIMEOUT)
            self._local.conn = c
        return c

    def _drop(self):
        c = getattr(self._local, "conn", None)
        if c is not None:
            try:
                c.close()
            except Exception:
                pass
        self._local.conn = None

    def get(self, path, etag=None, last_modified=None):
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; NKSE-schedule/1.0)",
            "Accept": "text/html",
            "Connection": "keep-alive",
        }
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified

        for attempt in range(2):
            try:
                conn = self._conn()
                conn.request("GET", path, headers=headers)
                resp = conn.getresponse()
                status = resp.status
                r_etag = resp.getheader("ETag")
                r_lm = resp.getheader("Last-Modified")
                if status == 304:
                    resp.read()
                    return {"status": 304, "body": None, "etag": r_etag, "last_modified": r_lm}
                body = resp.read() if status == 200 else None
                if status == 200:
                    return {"status": 200, "body": body, "etag": r_etag, "last_modified": r_lm}
                self._drop()
                return {"status": status, "body": None, "etag": r_etag, "last_modified": r_lm}
            except Exception:
                self._drop()
                if attempt == 1:
                    return {"status": 0, "body": None, "etag": None, "last_modified": None}
        return {"status": 0, "body": None, "etag": None, "last_modified": None}


# ------------------------------------------------------------------- cache i/o
def load_meta():
    try:
        with open(META_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_meta(meta):
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = META_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    os.replace(tmp, META_PATH)


def page_cache_path(key):
    return os.path.join(CACHE_DIR, f"page_{key}.json")


def load_cached_parsed(key):
    try:
        with open(page_cache_path(key), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def store_cached_parsed(key, data):
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        tmp = page_cache_path(key) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, page_cache_path(key))
    except Exception as e:
        print(f"[WARN] could not cache page {key}: {e}")


# ---------------------------------------------------------------------- config
days_map = {
    'pn': 'Понедельник',
    'vt': 'Вторник',
    'sr': 'Среда',
    'ch': 'Четверг',
    'pt': 'Пятница',
    'sb': 'Суббота',
}
prefixes = ['A_1', 'A_2', 'B_1', 'B_2']

master_schedule = {}
failed_pages = []
stats = {"downloaded": 0, "not_modified": 0, "network_error": 0, "bytes": 0, "parsed": 0, "reused_cached": 0}

PAGES = [(p, c) for p in prefixes for c in days_map]


def fetch_one(fetcher, meta, prefix, code):
    key = f"{prefix}_{code}"
    path = f"/html_pages/{key}.htm"
    prev = meta.get(key) or {}
    res = fetcher.get(path, prev.get("etag"), prev.get("last_modified"))
    status = res["status"]

    if status == 304:
        cached = load_cached_parsed(key)
        if cached is not None:
            stats["not_modified"] += 1
            return key, days_map[code], cached, "304"
        # no local copy: fall through to a full download without conditions
        res = fetcher.get(path, None, None)
        status = res["status"]

    if status == 200 and res["body"]:
        stats["downloaded"] += 1
        stats["bytes"] += len(res["body"])
        meta[key] = {"etag": res["etag"], "last_modified": res["last_modified"]}
        return key, days_map[code], res["body"].decode("utf-8", errors="ignore"), "200"

    cached = load_cached_parsed(key)
    if cached is not None:
        stats["reused_cached"] += 1
        return key, days_map[code], cached, "cache"

    stats["network_error"] += 1
    return key, days_map[code], None, "fail"


def main():
    t_start = time.time()
    meta = load_meta()
    fetcher = Fetcher()

    print(f"[parser] fetching {len(PAGES)} pages, {MAX_WORKERS} workers, conditional GET")

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = [ex.submit(fetch_one, fetcher, meta, p, c) for p, c in PAGES]
        for fut in concurrent.futures.as_completed(futs):
            try:
                results.append(fut.result())
            except Exception as e:
                print(f"[ERROR] worker failed: {e}")

    t_fetch = time.time() - t_start

    # parse sequentially (pure Python, GIL-bound; threads would not help)
    for key, day_name, payload, how in results:
        if payload is None:
            failed_pages.append((key, "fetch"))
            print(f"[WARN] no data for {key}")
            continue
        if how == "200":
            parsed = parse_page(payload, day_name)
            store_cached_parsed(key, parsed)
        else:
            parsed = payload
            stats["parsed"] += 0
        for group, days in parsed.items():
            if group not in master_schedule:
                master_schedule[group] = {d: [] for d in days_map.values()}
            for d, lessons in days.items():
                master_schedule[group][d] = lessons

    t_parse = time.time() - t_start - t_fetch
    save_meta(meta)

    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schedule.json")
    previous = {}
    if os.path.exists(output_path):
        try:
            with open(output_path, "r", encoding="utf-8") as f:
                previous = json.load(f)
        except Exception:
            previous = {}

    if failed_pages:
        failed_days = {days_map.get(c, c) for (p, c) in failed_pages}
        print(f"[WARN] {len(failed_pages)} page(s) unavailable: {[f[0] for f in failed_pages]}")
        for group, days in previous.items():
            if group not in master_schedule:
                master_schedule[group] = {d: [] for d in days_map.values()}
            for day_name in failed_days:
                if days.get(day_name):
                    master_schedule[group][day_name] = days[day_name]

    def count(d):
        return sum(len(v) for days in d.values() for v in days.values())

    new_count, old_count = count(master_schedule), count(previous)
    if old_count > 0 and new_count < old_count * 0.7:
        print(f"[ERROR] Refusing to write: {new_count} lessons vs {old_count}. Keeping existing file.")
        sys.exit(1)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(master_schedule, f, ensure_ascii=False, indent=2)

    total = time.time() - t_start
    print(
        f"[parser] {len(master_schedule)} groups, {new_count} lessons (was {old_count}) in {total:.2f}s"
    )
    print(
        f"[parser]   network {t_fetch:.2f}s | parse {t_parse:.2f}s | "
        f"downloaded {stats['downloaded']} ({stats['bytes']/1024:.0f} KB) | "
        f"304 unchanged {stats['not_modified']} | from cache {stats['reused_cached']} | "
        f"errors {stats['network_error']}"
    )


if __name__ == "__main__":
    main()
