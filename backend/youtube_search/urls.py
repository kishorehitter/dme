from django.urls import path
from .views import YouTubeSearchView, YouTubeStreamView, YouTubeFormatsView

urlpatterns = [
    path('search/', YouTubeSearchView.as_view(), name='youtube-search'),
    path('stream/', YouTubeStreamView.as_view(), name='youtube-stream'),
    path('formats/', YouTubeFormatsView.as_view(), name='youtube-formats'),
]
