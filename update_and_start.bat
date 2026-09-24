@echo off
chcp 65001 > nul
echo [i] Запуск сервера на порту 8090 для группы СЗ-13-26...
start "" http://localhost:8090
python server.py
pause
