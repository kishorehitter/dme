@echo off
REM Run Django with Daphne (ASGI server) - accessible from network
cd /d "%~dp0"

echo Starting Daphne on all interfaces...
echo WebSocket endpoint: ws://10.113.164.183:8000/ws/chat/{conversation_id}/
echo API endpoint: http://10.113.164.183:8000/api/
echo.

daphne -p 8000 -b 0.0.0.0 myproject.asgi:application
