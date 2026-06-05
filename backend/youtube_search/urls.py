from django.urls import path
from .views import YouTubeSearchView

urlpatterns = [
    path('search/', YouTubeSearchView.as_view(), name='youtube-search'),
]
