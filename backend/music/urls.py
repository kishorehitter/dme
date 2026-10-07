from django.urls import path
from .views import (
    InviteToMusicRoomView, YoutubeSearchView, YoutubeRelatedView, 
    MusicRoomMediaUploadView, MusicWatchHistoryView, MusicLikeToggleView, MusicLikesListView,
    YoutubeStreamView, YoutubeStreamProxyView, YoutubeDashManifestView,
)

urlpatterns = [
    path('youtube/search/',  YoutubeSearchView.as_view(),     name='youtube-search'),
    path('youtube/related/', YoutubeRelatedView.as_view(),    name='youtube-related'),
    path('youtube/stream/<str:video_id>/', YoutubeStreamView.as_view(), name='youtube-stream'),
    path('youtube/dash/<str:video_id>/', YoutubeDashManifestView.as_view(), name='youtube-dash'),

    path('youtube/proxy/<str:video_id>/<int:height>/<str:suffix>/', YoutubeStreamProxyView.as_view(), name='youtube-proxy'),
    path('youtube/proxy/<str:video_id>/<int:height>/<str:suffix>.mp4', YoutubeStreamProxyView.as_view(), name='youtube-proxy-mp4'),


    path('invite/', InviteToMusicRoomView.as_view(), name='music-invite'),
    path('upload/', MusicRoomMediaUploadView.as_view(), name='music-upload'),
    path('history/', MusicWatchHistoryView.as_view(), name='music-history'),
    path('likes/', MusicLikesListView.as_view(), name='music-likes'),
    path('likes/toggle/', MusicLikeToggleView.as_view(), name='music-likes-toggle'),
]
