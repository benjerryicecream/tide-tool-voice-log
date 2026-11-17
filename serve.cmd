@echo off
REM Serves this folder on http://127.0.0.1:8765/ so on-device transcription works.
REM Needs Python 3 on PATH. Close the window to stop the server.
cd /d "%~dp0"
start "" "http://127.0.0.1:8765/"
python -m http.server 8765 --bind 127.0.0.1
