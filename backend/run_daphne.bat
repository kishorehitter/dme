@echo off
REM Run Django with Daphne (ASGI server) - accessible from network
cd /d "%~dp0"

echo Starting Daphne on all interfaces...
echo WebSocket endpoint: ws://172.22.134.180:8000/ws/chat/{conversation_id}/
echo API endpoint: http://172.22.134.180:8000/api/
echo.

daphne -p 8000 -b 0.0.0.0 myproject.asgi:application
