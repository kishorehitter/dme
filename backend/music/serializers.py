from rest_framework import serializers
from .models import MusicWatchHistory, MusicLike

class MusicWatchHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = MusicWatchHistory
        fields = ['id', 'video_id', 'source', 'title', 'thumbnail', 'channel_title', 'watched_at']

class MusicLikeSerializer(serializers.ModelSerializer):
    class Meta:
        model = MusicLike
        fields = ['id', 'video_id', 'source', 'title', 'thumbnail', 'channel_title', 'liked_at']
