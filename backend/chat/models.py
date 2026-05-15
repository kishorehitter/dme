"""
Models for chat app - Conversations and Messages.
"""
from django.db import models
from django.conf import settings
from django.utils import timezone
import cloudinary.uploader
# import cloudinary.utils


# ─── Universal Cloudinary Storage ────────────────────────────────────────────
# Handles image, video, audio, and document uploads to Cloudinary.
# Root cause of previous bug: overriding _upload() is wrong — django-cloudinary-storage
# uses _save() internally. We must override _save() and _open() correctly.

class UniversalCloudinaryStorage:
    """
    Storage backend that uploads any file type to Cloudinary with the correct
    resource_type (image / video / raw) based on file extension.
    
    Replaces django-cloudinary-storage's MediaCloudinaryStorage entirely to
    avoid its image-only assumptions.
    """

    # Map extensions → Cloudinary resource_type
    VIDEO_EXTENSIONS  = {'mp4', 'mov', 'avi', 'mkv', 'webm'}
    AUDIO_EXTENSIONS  = {'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'}
    IMAGE_EXTENSIONS  = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'svg'}

    def _get_resource_type(self, name: str) -> str:
        ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
        if ext in self.VIDEO_EXTENSIONS or ext in self.AUDIO_EXTENSIONS:
            return 'video'   # Cloudinary uses 'video' for both video AND audio
        if ext in self.IMAGE_EXTENSIONS:
            return 'image'
        return 'raw'         # documents, unknown types

    def _get_public_id(self, name: str) -> str:
        """
        Return public_id WITH extension so Cloudinary stores and serves
        the file with the correct format.
        """
        # Strip leading upload directory prefix if present
        # e.g. 'chat_media/file.m4a' → 'chat_media/file.m4a'
        return name  # keep full path including extension as public_id

    def _save(self, name, content):
        """Upload file to Cloudinary and return the stored name (public_id)."""
        resource_type = self._get_resource_type(name)
        public_id     = self._get_public_id(name)

        try:
            response = cloudinary.uploader.upload(
                content,
                public_id=public_id,
                resource_type=resource_type,
                overwrite=True,
                invalidate=True,
            )
            # Return the public_id with version so URL generation works
            # Cloudinary returns public_id WITHOUT extension for video/image
            # but WITH extension for raw. We normalise to always include it.
            stored_public_id = response.get('public_id', public_id)
            version          = response.get('version')
            fmt              = response.get('format', '')

            # Build the canonical stored name that url() will later reconstruct
            # Format: v{version}/{public_id}.{format}
            if version and fmt and not stored_public_id.endswith(f'.{fmt}'):
                return f"v{version}/{stored_public_id}.{fmt}"
            elif version:
                return f"v{version}/{stored_public_id}"
            return stored_public_id

        except Exception as e:
            raise IOError(f"[UniversalCloudinaryStorage] Upload failed for '{name}': {e}") from e

    def _open(self, name, mode='rb'):
        """Not supported — Cloudinary files are accessed via URL only."""
        raise NotImplementedError("Opening Cloudinary files directly is not supported.")

    def url(self, name):
        """
        Return the full Cloudinary CDN URL for a stored file.
        Handles both versioned ('v123/path.ext') and plain ('path.ext') names.
        """
        if not name:
            return ''

        # Already a full URL (e.g. previously stored as absolute URL) — return as-is
        if name.startswith('http://') or name.startswith('https://'):
            return name

        # Determine resource type from extension
        resource_type = self._get_resource_type(name)

        # Strip leading v{version}/ prefix to get clean public_id for cloudinary.utils
        clean_name = name
        if clean_name.startswith('v') and '/' in clean_name:
            parts = clean_name.split('/', 1)
            if parts[0][1:].isdigit():  # 'v123' → version prefix
                clean_name = parts[1]

        cloud_name = settings.CLOUDINARY_STORAGE.get('CLOUD_NAME', '')
        
        # Build URL manually — reliable across all resource types
        url = f"https://res.cloudinary.com/{cloud_name}/{resource_type}/upload/{name}"
        return url

    def exists(self, name):
        """Check if file exists on Cloudinary."""
        try:
            resource_type = self._get_resource_type(name)
            cloudinary.uploader.explicit(name, type='upload', resource_type=resource_type)
            return True
        except Exception:
            return False

    def delete(self, name):
        """Delete file from Cloudinary."""
        try:
            resource_type = self._get_resource_type(name)
            cloudinary.uploader.destroy(name, resource_type=resource_type)
        except Exception:
            pass

    def size(self, name):
        return 0  # Not needed for chat app

    def get_available_name(self, name, max_length=None):
        return name  # Cloudinary handles overwrites via overwrite=True


def get_universal_storage():
    """
    Return the appropriate storage backend.
    - Production: UniversalCloudinaryStorage (all file types → Cloudinary)
    - Development: Django default FileSystemStorage (local disk)
    """
    if getattr(settings, 'IS_DEVELOPMENT', True):
        from django.core.files.storage import FileSystemStorage
        return FileSystemStorage()
    return UniversalCloudinaryStorage()


def get_image_storage():
    """
    Image-only storage (profile pictures, thumbnails).
    Uses UniversalCloudinaryStorage in production (handles images correctly).
    """
    return get_universal_storage()


# ─── Conversation ─────────────────────────────────────────────────────────────

class Conversation(models.Model):
    name        = models.CharField(max_length=255, blank=True, null=True)
    is_group    = models.BooleanField(default=False)
    description = models.TextField(blank=True, null=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)
    created_by  = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='created_conversations',
        null=True, blank=True
    )
    profile_picture = models.ImageField(
        upload_to='conversation_pics/',
        max_length=500,
        blank=True, null=True,
        storage=get_image_storage,   # ← callable, not instance
    )

    @property
    def clean_profile_picture_url(self):
        if not self.profile_picture:
            return None
        try:
            return self.profile_picture.url
        except Exception:
            return None

    class Meta:
        ordering        = ['-updated_at']
        verbose_name    = 'Conversation'
        verbose_name_plural = 'Conversations'

    def __str__(self):
        if self.name:
            return self.name
        return f"Conversation {self.id}"

    def get_conversation_name(self, user):
        if self.is_group:
            return self.name or f"Group {self.id}"
        other = self.participants.exclude(user=user).first()
        if other:
            return other.user.display_name
        return self.name or "Unknown"


# ─── ConversationParticipant ──────────────────────────────────────────────────

class ConversationParticipant(models.Model):
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
    joined_at         = models.DateTimeField(auto_now_add=True)
    last_read_message = models.ForeignKey(
        'Message',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='read_by_participants'
    )
    is_admin = models.BooleanField(default=False)

    class Meta:
        unique_together = ('conversation', 'user')
        ordering        = ['-joined_at']

    def __str__(self):
        email = self.user.email if self.user else f"User {self.user_id}"
        return f"{email} in Conversation {self.conversation_id}"


# ─── Message ──────────────────────────────────────────────────────────────────

class Message(models.Model):
    MESSAGE_TYPE_CHOICES = [
        ('text',     'Text'),
        ('image',    'Image'),
        ('video',    'Video'),
        ('audio',    'Audio'),
        ('document', 'Document'),
        ('system',   'System Notification'),
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
    content      = models.TextField(blank=True)
    message_type = models.CharField(max_length=20, choices=MESSAGE_TYPE_CHOICES, default='text')

    media_file = models.FileField(
        upload_to='chat_media/',
        max_length=500,           # ← 500 chars — Cloudinary URLs are long
        blank=True, null=True,
        storage=get_universal_storage,  # ← callable
    )
    thumbnail = models.ImageField(
        upload_to='chat_thumbnails/',
        max_length=500,
        blank=True, null=True,
        storage=get_image_storage,      # ← callable
    )
    reply_to = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='replies'
    )
    is_read      = models.BooleanField(default=False)
    is_deleted   = models.BooleanField(default=False)
    delivered_at = models.DateTimeField(null=True, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    edited_at    = models.DateTimeField(null=True, blank=True)
    audio_duration = models.IntegerField(null=True, blank=True)

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

    @property
    def clean_media_url(self):
        """Return the Cloudinary CDN URL for the media file."""
        if not self.media_file:
            return None
        try:
            return self.media_file.url
        except Exception:
            return None

    def __str__(self):
        email = self.sender.email if self.sender else f"Message {self.id}"
        if self.content:
            return f"{email}: {self.content[:50]}"
        return f"{email}: [{self.message_type}]"

    def mark_as_read(self):
        self.is_read = True
        self.save()


# ─── MessageReaction ──────────────────────────────────────────────────────────

class MessageReaction(models.Model):
    message    = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='reactions')
    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    emoji      = models.CharField(max_length=10)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('message', 'user', 'emoji')
        ordering        = ['created_at']

    def __str__(self):
        email = self.user.email if self.user else f"User {self.user_id}"
        return f"{email} reacted {self.emoji}"


# ─── Status ───────────────────────────────────────────────────────────────────

class Status(models.Model):
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
    media_file = models.FileField(
        upload_to='status_media/',
        max_length=500,
        storage=get_universal_storage,  # ← callable
    )
    caption    = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def clean_media_url(self):
        if not self.media_file:
            return None
        try:
            return self.media_file.url
        except Exception:
            return None

    @property
    def is_expired(self):
        from datetime import timedelta
        return timezone.now() > self.created_at + timedelta(hours=12)

    class Meta:
        ordering        = ['-created_at']
        verbose_name    = 'Status'
        verbose_name_plural = 'Statuses'

    def __str__(self):
        return f"Status by {self.user.email} at {self.created_at}"


# ─── StatusView ───────────────────────────────────────────────────────────────

class StatusView(models.Model):
    status    = models.ForeignKey('Status', on_delete=models.CASCADE, related_name='views')
    viewer    = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='status_views')
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


# ─── StatusLike ───────────────────────────────────────────────────────────────

class StatusLike(models.Model):
    status     = models.ForeignKey('Status', on_delete=models.CASCADE, related_name='likes')
    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='status_likes')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('status', 'user')
        ordering        = ['-created_at']

    def __str__(self):
        return f"{self.user} liked status {self.status.id}"