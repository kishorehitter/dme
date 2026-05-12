"""
Models for chat app - Conversations and Messages.
"""
from django.db import models
from django.conf import settings
from django.utils import timezone


class Conversation(models.Model):
    """
    Represents a conversation between users.
    Supports one-on-one and group chats.
    """
    name = models.CharField(max_length=255, blank=True, null=True)  # For group chats
    is_group = models.BooleanField(default=False)
    description = models.TextField(blank=True, null=True)  # Group bio
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='created_conversations',
        null=True,
        blank=True
    )
    profile_picture = models.ImageField(upload_to='conversation_pics/', blank=True, null=True)
    
    class Meta:
        ordering = ['-updated_at']
        verbose_name = 'Conversation'
        verbose_name_plural = 'Conversations'
    
    def __str__(self):
        if self.name:
            return self.name
        participants = self.participants.all()
        if len(participants) == 2:
            other = participants.exclude(user=self.created_by).first()
            if other and other.user.display_name:
                return other.user.display_name
        return f"Conversation {self.id}"
    
    def get_conversation_name(self, user):
        """Get conversation name from user's perspective."""
        if self.is_group:
            return self.name or f"Group {self.id}"
        other = self.participants.exclude(user=user).first()
        if other:
            return other.user.display_name
        return self.name or "Unknown"


class ConversationParticipant(models.Model):
    """
    Links users to conversations.
    Tracks last read message for each participant.
    """
    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name='participants'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='conversations'
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    last_read_message = models.ForeignKey(
        'Message',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='read_by_participants'
    )
    is_admin = models.BooleanField(default=False)  # For group chats
    
    class Meta:
        unique_together = ('conversation', 'user')
        ordering = ['-joined_at']
    
    def __str__(self):
        user_str = str(self.user.email) if self.user and self.user.email else f"User {self.user_id}"
        conv_str = str(self.conversation) if self.conversation else f"Conversation {self.conversation_id}"
        return f"{user_str} in {conv_str}"


class Message(models.Model):
    """
    Represents a message in a conversation.
    """
    MESSAGE_TYPE_CHOICES = [
        ('text', 'Text'),
        ('image', 'Image'),
        ('video', 'Video'),
        ('audio', 'Audio'),
        ('document', 'Document'),
        ('system', 'System Notification'),
    ]

    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name='messages'
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='sent_messages'
    )
    content = models.TextField(blank=True)  # Empty for media-only messages
    message_type = models.CharField(max_length=20, choices=MESSAGE_TYPE_CHOICES, default='text')
    media_file = models.FileField(upload_to='chat_media/', blank=True, null=True)
    thumbnail = models.ImageField(upload_to='chat_thumbnails/', blank=True, null=True)
    reply_to = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='replies'
    )
    is_read = models.BooleanField(default=False)
    is_deleted = models.BooleanField(default=False)
    delivered_at = models.DateTimeField(null=True, blank=True)  # When message reached receiver's device
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    audio_duration = models.IntegerField(null=True, blank=True)  # Duration in seconds for audio messages
    
    # Track which users have cleared this message from their view (WhatsApp-style "Clear chat")
    cleared_by = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='cleared_messages',
        blank=True
    )

    class Meta:
        ordering = ['created_at']
        verbose_name = 'Message'
        verbose_name_plural = 'Messages'
        indexes = [
            models.Index(fields=['conversation', '-created_at']),
        ]

    def __str__(self):
        sender_str = str(self.sender.email) if self.sender else f"Message {self.id}"
        if self.content:
            return f"{sender_str}: {self.content[:50]}"
        return f"{sender_str}: [{self.message_type} message]"

    def mark_as_read(self):
        """Mark message as read."""
        self.is_read = True
        self.save()

class MessageReaction(models.Model):
    """
    Reactions (emoji) to messages.
    """
    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name='reactions'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE
    )
    emoji = models.CharField(max_length=10)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ('message', 'user', 'emoji')
        ordering = ['created_at']
    
    def __str__(self):
        user_str = str(self.user.email) if self.user and self.user.email else f"User {self.user_id}"
        return f"{user_str} reacted {self.emoji} to message"

class Status(models.Model):
    """
    WhatsApp-style status (story).
    Auto-disappears after 12 hours.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='statuses'
    )
    media_type = models.CharField(
      max_length=10,
      choices=[('photo', 'Photo'), ('video', 'Video')],
      default='photo',
    )
    media_file = models.FileField(upload_to='status_media/')
    caption = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    
    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Status'
        verbose_name_plural = 'Statuses'

    def __str__(self):
        return f"Status by {self.user.email} at {self.created_at}"

    @property
    def is_expired(self):
        """Check if status is older than 12 hours."""
        from datetime import timedelta
        return timezone.now() > self.created_at + timedelta(hours=12)
    
class StatusView(models.Model):
    status = models.ForeignKey(
        'Status',
        on_delete=models.CASCADE,
        related_name='views',
    )
    viewer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='status_views',
    )
    viewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-viewed_at']
        constraints = [
            models.UniqueConstraint(fields=['status', 'viewer'], name='unique_status_view')
        ]
        indexes = [
            models.Index(fields=['status', 'viewer']),
        ]

    def __str__(self):
        return f"{self.viewer} viewed status {self.status.id}"
    
class StatusLike(models.Model):
    status = models.ForeignKey(
        'Status',
        on_delete=models.CASCADE,
        related_name='likes',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='status_likes',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('status', 'user')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user} liked status {self.status.id}"