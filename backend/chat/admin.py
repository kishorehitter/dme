"""
Admin configuration for chat app.
"""
from django.contrib import admin
from .models import Conversation, ConversationParticipant, Message, MessageReaction


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'is_group', 'created_by', 'created_at', 'updated_at')
    list_filter = ('is_group', 'created_at')
    search_fields = ('name', 'participants__user__email')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(ConversationParticipant)
class ConversationParticipantAdmin(admin.ModelAdmin):
    list_display = ('id', 'conversation', 'user', 'joined_at', 'is_admin')
    list_filter = ('is_admin', 'joined_at')
    search_fields = ('conversation__name', 'user__email')


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'conversation', 'sender', 'content_preview', 'message_type', 'is_read', 'delivered_at', 'created_at')
    list_filter = ('message_type', 'is_read', 'is_deleted', 'delivered_at', 'created_at')
    search_fields = ('content', 'sender__email', 'conversation__name')
    readonly_fields = ('created_at', 'edited_at', 'delivered_at')

    def content_preview(self, obj):
        return obj.content[:50] if obj.content else '[Media]'
    content_preview.short_description = 'Content'


@admin.register(MessageReaction)
class MessageReactionAdmin(admin.ModelAdmin):
    list_display = ('id', 'message', 'user', 'emoji', 'created_at')
    list_filter = ('emoji', 'created_at')
    search_fields = ('message__content', 'user__email')
