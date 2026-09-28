import urllib.request
import re
from html.parser import HTMLParser
import sys
import json
import os
import time

sys.stdout.reconfigure(encoding='utf-8')

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
        # (row_index, col_index) -> (tr_class, td_class)
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
    """Return the set of (tr_class, td_class) pairs styled LightGreen.
    Those cells are substituted lessons (замена) on the source site."""
    green = set()
    for m in re.finditer(r"tr\.(\S+)\s+td\.(\S+)\s*\{([^}]*)\}", html):
        tr_class, td_class, body = m.group(1), m.group(2), m.group(3)
        if 'lightgreen' in body.lower():
            green.add((tr_class, td_class))
    return green

days_map = {
    'pn': 'Понедельник',
    'vt': 'Вторник',
    'sr': 'Среда',
    'ch': 'Четверг',
    'pt': 'Пятница',
    'sb': 'Суббота'
}

prefixes = ['A_1', 'A_2', 'B_1', 'B_2']
master_schedule = {}
failed_pages = []

# Global time budget: a total outage must fail fast instead of hanging.
# 24 pages x retries x socket timeout can otherwise add up to ~24 minutes.
DEADLINE = time.time() + 180
PER_REQUEST_TIMEOUT = 10
ATTEMPTS = 2

def fetch_page(url):
    for attempt in range(ATTEMPTS):
        if time.time() > DEADLINE:
            return None
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=PER_REQUEST_TIMEOUT) as resp:
                return resp.read().decode('utf-8', errors='ignore')
        except Exception:
            if attempt < ATTEMPTS - 1:
                time.sleep(1)
    return None

for prefix in prefixes:
    for code, day_name in days_map.items():
        if time.time() > DEADLINE:
            print("[WARN] Time budget exhausted, stopping fetch loop")
            failed_pages.append((prefix, code))
            continue
        url = f"http://do.nkse.ru/html_pages/{prefix}_{code}.htm"
        html = fetch_page(url)
        if html is None:
            print(f"[WARN] Failed to fetch {url}")
            failed_pages.append((prefix, code))
            continue
        try:
            green_cells = parse_green_cells(html)
            parser = DetailedTableParser()
            parser.feed(html)
            
            table = parser.rows
            if not table:
                print(f"[WARN] Empty table from {url}")
                failed_pages.append((prefix, code))
                continue
            
            def is_substituted(row_idx, col_idx):
                key = parser.cell_keys.get((row_idx, col_idx))
                if not key:
                    return False
                tr_class, td_class = key
                if not td_class:
                    return False
                if (tr_class, td_class) in green_cells:
                    return True
                # some stylesheets omit the tr qualifier
                return any(td == td_class for (tr, td) in green_cells)
            
            for r_i, row in enumerate(table):
                for c_i, cell in enumerate(row):
                    cleaned_cell = cell.strip()
                    if re.match(r'^[А-ЯЁA-Z]+-\d+-\d+$', cleaned_cell) and len(cleaned_cell) >= 3 and len(cleaned_cell) <= 15:
                        group_name = cleaned_cell
                        if group_name not in master_schedule:
                            master_schedule[group_name] = {d: [] for d in days_map.values()}
                        
                        offsets_subject = [1, 5, 9, 13, 17, 21]
                        offsets_time = [3, 7, 11, 15, 19, 23]
                        
                        lessons = []
                        for i in range(len(offsets_subject)):
                            s_idx = r_i + offsets_subject[i]
                            t_idx = r_i + offsets_time[i]
                            
                            subject = ""
                            time_str = ""
                            num = str(i + 1)
                            
                            if s_idx < len(table) and len(table[s_idx]) > c_i:
                                subject = table[s_idx][c_i].strip()
                            
                            if t_idx < len(table) and len(table[t_idx]) > 0:
                                time_str = table[t_idx][0].strip()
                            
                            if not subject or subject == group_name:
                                continue
                                
                            teachers = []
                            rooms = []
                            
                            # Subgroup 1 (row t_idx)
                            t1_col = 2 * c_i - 1
                            r1_col = 2 * c_i
                            if t_idx < len(table):
                                if t1_col < len(table[t_idx]):
                                    val = table[t_idx][t1_col].strip()
                                    if val and not re.search(r'\d{1,2}:\d{2}', val) and val != subject:
                                        if val not in teachers: teachers.append(val)
                                if r1_col < len(table[t_idx]):
                                    val = table[t_idx][r1_col].strip()
                                    if val and not re.search(r'\d{1,2}:\d{2}', val) and val != subject:
                                        if val not in rooms: rooms.append(val)

                            # Subgroup 2 (row t_idx + 1)
                            if t_idx + 1 < len(table):
                                t2_col = 2 * c_i - 2
                                r2_col = 2 * c_i - 1
                                if t2_col < len(table[t_idx + 1]):
                                    val = table[t_idx + 1][t2_col].strip()
                                    if val and not re.search(r'\d{1,2}:\d{2}', val) and val != subject and val not in teachers:
                                        teachers.append(val)
                                if r2_col < len(table[t_idx + 1]):
                                    val = table[t_idx + 1][r2_col].strip()
                                    if val and not re.search(r'\d{1,2}:\d{2}', val) and val != subject and val not in rooms:
                                        rooms.append(val)

                            subgroups = []
                            max_len = max(len(teachers), len(rooms), 1)
                            for i in range(max_len):
                                t = teachers[i] if i < len(teachers) else (teachers[0] if teachers else "")
                                r = rooms[i] if i < len(rooms) else (rooms[0] if rooms else "")
                                subgroups.append({"teacher": t, "room": r})

                            lesson = {
                                "number": num,
                                "time": time_str,
                                "subject": subject,
                                "teacher": ", ".join(teachers),
                                "room": ", ".join(rooms),
                                "subgroups": subgroups
                            }
                            if is_substituted(s_idx, c_i):
                                lesson["substituted"] = True
                            lessons.append(lesson)
                        
                        if lessons:
                            master_schedule[group_name][day_name] = lessons
        except Exception as e:
            print(f"[ERROR] Parse failed for {url}: {e}")
            failed_pages.append((prefix, code))

output_path = os.path.join(os.path.dirname(__file__), "schedule.json")

# Load previous data to preserve days whose source pages failed
previous = {}
if os.path.exists(output_path):
    try:
        with open(output_path, "r", encoding="utf-8") as f:
            previous = json.load(f)
    except Exception:
        previous = {}

# Restore data for days we could not fetch
if failed_pages:
    failed_days = {days_map[code] for prefix, code in failed_pages}
    print(f"[WARN] {len(failed_pages)} page(s) failed: {failed_pages}")
    print(f"[WARN] Restoring previously known data for: {sorted(failed_days)}")
    for group_name, days in previous.items():
        if group_name not in master_schedule:
            master_schedule[group_name] = {d: [] for d in days_map.values()}
        for day_name in failed_days:
            old_lessons = days.get(day_name)
            if old_lessons:
                master_schedule[group_name][day_name] = old_lessons

# Safety check: never write a drastically smaller dataset
def count_lessons(data):
    return sum(len(v) for days in data.values() for v in days.values())

new_count = count_lessons(master_schedule)
old_count = count_lessons(previous)
if old_count > 0 and new_count < old_count * 0.7:
    print(f"[ERROR] Refusing to write: {new_count} lessons vs {old_count} previously. Keeping existing file.")
    sys.exit(1)

with open(output_path, "w", encoding="utf-8") as f:
    json.dump(master_schedule, f, ensure_ascii=False, indent=2)

print(f"Successfully re-parsed {len(master_schedule)} groups ({new_count} lessons, was {old_count}).")

