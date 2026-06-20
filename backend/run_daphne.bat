@echo off
REM Run Django with Daphne (ASGI server) - accessible from network
cd /d "%~dp0"

setlocal enabledelayedexpansion

rem Automatically detect the active local IP address
set "LOCAL_IP=127.0.0.1"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set "val=%%a"
    set "val=!val: =!"
    if not "!val!"=="" (
        set "LOCAL_IP=!val!"
    )
)

echo Starting Daphne on all interfaces (0.0.0.0)...
echo Your local network IP is: %LOCAL_IP%
echo.
echo WebSocket endpoint: ws://%LOCAL_IP%:8000/ws/chat/{conversation_id}/
echo API endpoint:       http://%LOCAL_IP%:8000/api/
echo.

daphne -p 8000 -b 0.0.0.0 myproject.asgi:application