"""
Models for WebRTC calling functionality.
"""
from django.db import models
from django.conf import settings
from django.utils import timezone
from datetime import timedelta


class Call(models.Model):
    """
    Represents a WebRTC call between users.
    Tracks call metadata for history and analytics.
    """
    CALL_TYPE_CHOICES = [
        ('audio', 'Audio Call'),
        ('video', 'Video Call'),
    ]

    STATUS_CHOICES = [
        ('initiated', 'Initiated'),
        ('ringing', 'Ringing'),
        ('accepted', 'Accepted'),
        ('rejected', 'Rejected'),
        ('ended', 'Ended'),
        ('missed', 'Missed'),
    ]

    # Call participants
    caller = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='calls_made',
    )
    receiver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='calls_received',
    )

    # Call details
    call_type = models.CharField(
        max_length=10,
        choices=CALL_TYPE_CHOICES,
        default='audio',
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='initiated',
    )

    # Timing
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    duration = models.IntegerField(
        null=True,
        blank=True,
        help_text='Call duration in seconds'
    )

    # WebRTC signaling data (stored temporarily for debugging)
    offer_sdp = models.TextField(null=True, blank=True)
    answer_sdp = models.TextField(null=True, blank=True)
    
    # Buffered ICE candidates (JSON field to store candidates before receiver connects)
    ice_candidates = models.JSONField(
        null=True,
        blank=True,
        default=list,
        help_text='Buffered ICE candidates waiting for receiver'
    )

    class Meta:
        ordering = ['-started_at']
        verbose_name = 'Call'
        verbose_name_plural = 'Calls'
        indexes = [
            models.Index(fields=['caller', '-started_at']),
            models.Index(fields=['receiver', '-started_at']),
            models.Index(fields=['status', '-started_at']),
        ]

    def __str__(self):
        return f"{self.caller.email} -> {self.receiver.email} ({self.call_type}, {self.status})"

    def calculate_duration(self):
        """Calculate and save call duration in seconds."""
        if self.ended_at and self.started_at:
            self.duration = int((self.ended_at - self.started_at).total_seconds())
            self.save(update_fields=['duration'])
        return self.duration

    def end_call(self):
        """Mark call as ended and calculate duration."""
        self.ended_at = timezone.now()
        self.status = 'ended'
        self.calculate_duration()
        self.save(update_fields=['ended_at', 'status', 'duration'])

    def reject_call(self):
        """Mark call as rejected."""
        self.status = 'rejected'
        self.ended_at = timezone.now()
        self.save(update_fields=['status', 'ended_at'])

    def mark_missed(self):
        """Mark call as missed."""
        self.status = 'missed'
        self.ended_at = timezone.now()
        self.save(update_fields=['status', 'ended_at'])

    def check_and_mark_missed(self):
        """Auto-mark as missed if ringing for >30 seconds."""
        from datetime import timedelta
        if self.status == 'ringing':
            time_ringing = timezone.now() - self.started_at
            if time_ringing > timedelta(seconds=30):
                self.mark_missed()
                return True
        return False


class GroupCall(models.Model):
    """
    Represents an ongoing or past group call within a conversation.
    """
    CALL_TYPE_CHOICES = [
        ('audio', 'Audio Call'),
        ('video', 'Video Call'),
    ]

    conversation = models.ForeignKey(
        'chat.Conversation',
        on_delete=models.CASCADE,
        related_name='group_calls'
    )
    initiator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='initiated_group_calls'
    )
    call_type = models.CharField(
        max_length=10,
        choices=CALL_TYPE_CHOICES,
        default='audio'
    )
    is_active = models.BooleanField(default=True)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    room_id = models.CharField(max_length=100, unique=True, null=True, blank=True) # For SFU like LiveKit/Jitsi

    class Meta:
        ordering = ['-started_at']

    def __str__(self):
        return f"Group {self.call_type} in {self.conversation}"

class GroupCallParticipant(models.Model):
    """
    Tracks participants in a group call.
    """
    group_call = models.ForeignKey(
        GroupCall,
        on_delete=models.CASCADE,
        related_name='participants'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    left_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('group_call', 'user')
