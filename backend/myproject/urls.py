"""
URL configuration for DME backend.
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/accounts/', include('accounts.urls')),
    path('api/chat/', include('chat.urls')),
    path('api/fcm/', include('notifications.urls')),
    path('api/calls/', include('calls.urls')),
    path('api/youtube/', include('youtube_search.urls')),
    path('api/music/', include('music.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
