"""
URLs for chat app.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ConversationViewSet,
    MessageViewSet,
    ConversationDetailView,
    MarkMessagesReadView,
    AddParticipantView,
    RemoveParticipantView,
    SearchUsersView,
    GetOrCreateDirectConversationView,
    MessageReactionView,
    MessageEditView,
    MessageDeleteView,
    ClearChatView,
    DeleteConversationView,
    ConversationMediaView,
    StatusViewersListView,
    ConversationUpdateProfileView,
    HealthCheckView,
)
from .status_views import StatusViewSet

router = DefaultRouter()
router.register(r'conversations', ConversationViewSet, basename='conversation')
router.register(r'statuses', StatusViewSet, basename='status')

urlpatterns = [
    # Health Check
    path('health/', HealthCheckView.as_view(), name='health-check'),
    
    # Conversation details
    path('conversations/<int:pk>/detail/', ConversationDetailView.as_view(), name='conversation-detail'),
    path('conversations/<int:pk>/update-profile/', ConversationUpdateProfileView.as_view(), name='update-conversation-profile'),

    # Messages within a conversation
    path('conversations/<int:conversation_id>/messages/', MessageViewSet.as_view({'get': 'list', 'post': 'create', 'delete': 'destroy'}), name='message-list'),
    path('conversations/<int:conversation_id>/messages/<int:pk>/', MessageViewSet.as_view({'get': 'retrieve', 'put': 'update', 'patch': 'partial_update', 'delete': 'destroy'}), name='message-detail'),

    # Clear chat (WhatsApp-style - clear messages for current user only)
    path('conversations/<int:conversation_id>/clear/', ClearChatView.as_view(), name='clear-chat'),

    # Delete conversation (remove from user's chat list)
    path('conversations/<int:conversation_id>/delete/', DeleteConversationView.as_view(), name='delete-conversation'),

    # Conversation media
    path('conversations/<int:conversation_id>/media/', ConversationMediaView.as_view(), name='conversation-media'),

    # Mark messages as read
    path('conversations/<int:conversation_id>/mark-read/', MarkMessagesReadView.as_view(), name='mark-read'),

    # Add participants to group
    path('conversations/<int:conversation_id>/add-participants/', AddParticipantView.as_view(), name='add-participants'),

    # Remove participant from group
    path('conversations/<int:conversation_id>/remove-participant/', RemoveParticipantView.as_view(), name='remove-participant'),

    # Search users
    path('users/search/', SearchUsersView.as_view(), name='search-users'),

    # Get or create direct conversation
    path('users/<int:user_id>/chat/', GetOrCreateDirectConversationView.as_view(), name='get-or-create-chat'),

    # Message reactions
    path('messages/<int:message_id>/react/', MessageReactionView.as_view(), name='message-reaction'),

    # Message edit (sender only)
    path('messages/<int:message_id>/edit/', MessageEditView.as_view(), name='message-edit'),

    # Message delete (unsend for sender, delete for receiver)
    path('messages/<int:message_id>/delete/', MessageDeleteView.as_view(), name='message-delete'),

    # Status viewers list
    path('statuses/<int:status_id>/viewers/', StatusViewersListView.as_view(), name='status-viewers'),

    # Router URLs (keep at the end)
    path('', include(router.urls)),
]
