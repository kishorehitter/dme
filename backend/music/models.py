from django.db import models
from django.conf import settings

class MusicWatchHistory(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='music_history')
    video_id = models.CharField(max_length=255)
    source = models.CharField(max_length=20, default='youtube') # 'youtube' or 'drive'
    title = models.CharField(max_length=500)
    thumbnail = models.CharField(max_length=1000, null=True, blank=True)
    channel_title = models.CharField(max_length=255, null=True, blank=True)
    watched_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-watched_at']
        verbose_name_plural = "Music watch histories"

class MusicLike(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='music_likes')
    video_id = models.CharField(max_length=255)
    source = models.CharField(max_length=20, default='youtube') # 'youtube' or 'drive'
    title = models.CharField(max_length=500)
    thumbnail = models.CharField(max_length=1000, null=True, blank=True)
    channel_title = models.CharField(max_length=255, null=True, blank=True)
    liked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'video_id', 'source')
        ordering = ['-liked_at']
