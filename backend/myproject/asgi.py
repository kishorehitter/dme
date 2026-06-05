"""
ASGI config for DME project.
"""
import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from channels.security.websocket import AllowedHostsOriginValidator

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'myproject.settings')

django_asgi_app = get_asgi_application()

# Import routing after Django setup
from chat.routing import websocket_urlpatterns as chat_urlpatterns
from calls.routing import websocket_urlpatterns as call_urlpatterns
from music.routing import websocket_urlpatterns as music_urlpatterns

# Combine all WebSocket URL patterns
websocket_urlpatterns = chat_urlpatterns + call_urlpatterns + music_urlpatterns

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AllowedHostsOriginValidator(
        AuthMiddlewareStack(
            URLRouter(websocket_urlpatterns)
        )
    ),
})
