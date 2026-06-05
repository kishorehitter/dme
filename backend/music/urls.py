from django.urls import path
from .views import InviteToMusicRoomView, YoutubeSearchView, YoutubeRelatedView

urlpatterns = [
    path('youtube/search/',  YoutubeSearchView.as_view(),     name='youtube-search'),
    path('youtube/related/', YoutubeRelatedView.as_view(),    name='youtube-related'),
    path('invite/', InviteToMusicRoomView.as_view(), name='music-invite'),
]
