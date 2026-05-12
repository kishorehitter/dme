# Start Daphne with extended timeout for WebSocket connections
# --application-close-timeout: Time before killing idle applications (default: 30s)
# We set it to 5 minutes (300s) to allow calls to complete
daphne -p 8000 -b 0.0.0.0 --application-close-timeout 300 myproject.asgi:application
