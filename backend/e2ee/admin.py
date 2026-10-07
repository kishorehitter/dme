from django.contrib import admin
from .models import IdentityKey, SignedPreKey, OneTimePreKey

@admin.register(IdentityKey)
class IdentityKeyAdmin(admin.ModelAdmin):
    list_display = ['user', 'created_at', 'updated_at']
    search_fields = ['user__email', 'user__username']

@admin.register(SignedPreKey)
class SignedPreKeyAdmin(admin.ModelAdmin):
    list_display = ['user', 'key_id', 'created_at']
    search_fields = ['user__email', 'user__username']
    list_filter = ['created_at']

@admin.register(OneTimePreKey)
class OneTimePreKeyAdmin(admin.ModelAdmin):
    list_display = ['user', 'key_id', 'created_at']
    search_fields = ['user__email', 'user__username']
    list_filter = ['created_at']
