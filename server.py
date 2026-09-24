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

def run_parser():
    parser_script = os.path.join(DIRECTORY, "update_all_groups_v3.py")
    if os.path.exists(parser_script):
        try:
            subprocess.run([sys.executable, parser_script], check=True, timeout=60)
            print("[Server] Парсер успешно обновил schedule.json")
        except Exception as e:
            print("[Server Parser Error]:", e)

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

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
        else:
            super().do_GET()

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    if not os.path.exists(JSON_PATH) or os.path.getsize(JSON_PATH) < 100:
        print("[Server] Создание начального schedule.json...")
        run_parser()
    else:
        print("[Server] Используем существующий schedule.json, фоновое обновление...")
        threading.Thread(target=run_parser, daemon=True).start()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        print(f"[Server] Сервер запущен: http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
