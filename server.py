import http.server
import socketserver
import json
import os
import threading
import time
import sys
import subprocess
import gzip

PORT = 8090
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(DIRECTORY, "schedule.json")
LOG_PATH = os.path.join(DIRECTORY, "server.log")
REPARSE_INTERVAL = 6 * 60 * 60  # same cadence as the cloud auto-update
GZIP_MIN_BYTES = 1024  # below this the gzip header costs more than it saves
COMPRESSIBLE = (".json", ".js", ".html", ".css", ".svg", ".webmanifest")

def log(msg):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

def run_parser():
    parser_script = os.path.join(DIRECTORY, "update_all_groups_v3.py")
    if not os.path.exists(parser_script):
        log("Парсер не найден, пропуск")
        return
    log("Запуск парсера...")
    try:
        subprocess.run([sys.executable, parser_script], check=True, timeout=240)
        log("Парсер успешно обновил schedule.json")
    except subprocess.CalledProcessError as e:
        # parser refused to write (safety check tripped) - existing file kept
        log(f"Парсер не обновил файл (код {e.returncode}), прежний schedule.json сохранён")
    except subprocess.TimeoutExpired:
        log("Парсер не уложился в 240с, прежний schedule.json сохранён")
    except Exception as e:
        log(f"Ошибка парсера: {e}")

def periodic_reparse():
    while True:
        time.sleep(REPARSE_INTERVAL)
        log("Плановое обновление расписания")
        run_parser()

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, fmt, *args):
        pass  # keep the console readable; errors go to log()

    def end_headers(self):
        # The service worker + ETag checks already decide what is fresh, so the
        # browser HTTP cache only gets in the way.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _accepts_gzip(self):
        return "gzip" in (self.headers.get("Accept-Encoding") or "").lower()

    def send_compressed_file(self, path):
        """Serve a static file gzipped.

        schedule.json is ~1 MB of JSON and goes down to ~120 KB, which is the
        single biggest win available without touching the UI.
        """
        ctype = self.guess_type(path)
        with open(path, "rb") as f:
            raw = f.read()

        if len(raw) >= GZIP_MIN_BYTES and self._accepts_gzip():
            # mtime=0 keeps the gzip bytes stable, so ETag/304 keep working.
            body = gzip.compress(raw, compresslevel=6, mtime=0)
            self.send_response(200)
            self.send_header("Content-type", ctype)
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Vary", "Accept-Encoding")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return

        self.send_response(200)
        self.send_header("Content-type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        # Static files that benefit from compression.
        clean = self.path.split("?", 1)[0].split("#", 1)[0]
        if clean.lower().endswith(COMPRESSIBLE):
            target = os.path.join(DIRECTORY, clean.lstrip("/").replace("/", os.sep))
            if os.path.isfile(target):
                try:
                    self.send_compressed_file(target)
                    return
                except (BrokenPipeError, ConnectionResetError):
                    return

        if self.path.startswith('/api/refresh'):
            try:
                run_parser()
                self.send_response(200)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "message": "Расписание всех групп обновлено!"}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}, ensure_ascii=False).encode('utf-8'))
        elif self.path.startswith('/api/schedule-version'):
            try:
                if os.path.exists(JSON_PATH):
                    mod_time = os.path.getmtime(JSON_PATH)
                    self.send_response(200)
                    self.send_header('Content-type', 'application/json; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(json.dumps({"mod_time": mod_time}, ensure_ascii=False).encode('utf-8'))
                else:
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": "Schedule not found"}, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}, ensure_ascii=False).encode('utf-8'))
        elif self.path.startswith('/api/health'):
            try:
                payload = {
                    "ok": os.path.exists(JSON_PATH),
                    "groups": 0,
                    "bytes": os.path.getsize(JSON_PATH) if os.path.exists(JSON_PATH) else 0,
                    "mod_time": os.path.getmtime(JSON_PATH) if os.path.exists(JSON_PATH) else None,
                }
                if payload["ok"]:
                    with open(JSON_PATH, "r", encoding="utf-8") as f:
                        payload["groups"] = len(json.load(f))
                self.send_response(200)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps(payload).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        else:
            super().do_GET()

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    log("=" * 40)
    if not os.path.exists(JSON_PATH) or os.path.getsize(JSON_PATH) < 100:
        log("Создание начального schedule.json...")
        run_parser()
    else:
        log("Используем существующий schedule.json, фоновое обновление...")
        threading.Thread(target=run_parser, daemon=True).start()
    threading.Thread(target=periodic_reparse, daemon=True).start()

    socketserver.TCPServer.allow_reuse_address = True
    socketserver.TCPServer.daemon_threads = True
    with socketserver.ThreadingTCPServer(("", PORT), CustomHandler) as httpd:
        log(f"Сервер запущен: http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            log("Остановка по Ctrl+C")
        except Exception as e:
            log(f"Сервер упал: {e}")
            raise
