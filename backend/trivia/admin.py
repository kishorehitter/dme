from django.contrib import admin
from .models import TriviaChallenge


@admin.register(TriviaChallenge)
class TriviaChallengeAdmin(admin.ModelAdmin):
    list_display = ['token', 'challenger', 'recipient', 'category', 'set_id', 'is_used', 'created_at', 'expires_at']
    list_filter = ['is_used', 'category']
    search_fields = ['challenger__email', 'recipient__email']
