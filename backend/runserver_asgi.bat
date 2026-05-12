@echo off
REM Run Django with ASGI support for WebSockets
REM Uses daphne (ASGI server) instead of runserver

cd /d "%~dp0"

REM Activate the virtual environment
call "..\.venv\Scripts\activate.bat"

echo Starting Django with ASGI (daphne)...
echo WebSocket endpoint: ws://127.0.0.1:8000/ws/chat/{conversation_id}/
echo API endpoint: http://127.0.0.1:8000/api/
echo.

daphne -p 8000 myproject.asgi:application
