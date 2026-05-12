"""
WebSocket URL routing for call signaling.
"""
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # ✅ Capture call_id as a named group (supports integers, UUIDs, hyphens)
    re_path(r'ws/call/(?P<call_id>[\w-]+)/$', consumers.CallConsumer.as_asgi()),
]