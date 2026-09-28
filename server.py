import http.server
import socketserver
import json
import os
import threading
import time
import sys
import subprocess

PORT = 8090
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(DIRECTORY, "schedule.json")
LOG_PATH = os.path.join(DIRECTORY, "server.log")
REPARSE_INTERVAL = 6 * 60 * 60  # same cadence as the cloud auto-update

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
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


    def do_GET(self):
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
