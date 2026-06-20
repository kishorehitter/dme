from django.urls import path
from .views import YouTubeSearchView, YouTubeStreamView

urlpatterns = [
    path('search/', YouTubeSearchView.as_view(), name='youtube-search'),
    path('stream/', YouTubeStreamView.as_view(), name='youtube-stream'),
]
