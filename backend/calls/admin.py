from django.contrib import admin
from .models import Call


@admin.register(Call)
class CallAdmin(admin.ModelAdmin):
    list_display = ['caller', 'receiver', 'call_type', 'status', 'started_at', 'duration']
    list_filter = ['call_type', 'status', 'started_at']
    search_fields = ['caller__email', 'receiver__email']
    readonly_fields = ['started_at', 'ended_at', 'duration']
    date_hierarchy = 'started_at'
