# backend/music/routing.py
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(
        r'ws/music/(?P<room_code>\w+)/$',
        consumers.MusicConsumer.as_asgi()
    ),
]