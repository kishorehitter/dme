"""
URL configuration for DME backend.
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from myproject import views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/accounts/', include('accounts.urls')),
    path('api/chat/', include('chat.urls')),
    path('api/fcm/', include('notifications.urls')),
    path('api/calls/', include('calls.urls')),
    path('api/youtube/', include('youtube_search.urls')),
    path('api/music/', include('music.urls')),
    path('api/trivia/', include('trivia.urls')),
    path('api/e2ee/', include('e2ee.urls')),
    
    # Share / Download routes
    path('invite', views.download_app, name='download_app'),
    path('invite/', views.download_app, name='download_app_slash'),
    path('.well-known/assetlinks.json', views.assetlinks_json, name='assetlinks'),

    # Trivia challenge browser landing page
    path('trivia/challenge/<uuid:token>/', views.trivia_challenge_redirect, name='trivia-challenge-redirect'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
