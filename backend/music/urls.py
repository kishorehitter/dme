from django.urls import path
from .views import (
    InviteToMusicRoomView, YoutubeSearchView, YoutubeRelatedView, 
    MusicRoomMediaUploadView, MusicWatchHistoryView, MusicLikeToggleView, MusicLikesListView
)

urlpatterns = [
    path('youtube/search/',  YoutubeSearchView.as_view(),     name='youtube-search'),
    path('youtube/related/', YoutubeRelatedView.as_view(),    name='youtube-related'),
    path('invite/', InviteToMusicRoomView.as_view(), name='music-invite'),
    path('upload/', MusicRoomMediaUploadView.as_view(), name='music-upload'),
    path('history/', MusicWatchHistoryView.as_view(), name='music-history'),
    path('likes/', MusicLikesListView.as_view(), name='music-likes'),
    path('likes/toggle/', MusicLikeToggleView.as_view(), name='music-likes-toggle'),
]
