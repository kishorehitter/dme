"""
Models for chat app - Conversations and Messages.
"""
import re
from django.db import models
from django.conf import settings
from django.utils import timezone
from cloudinary_storage.storage import MediaCloudinaryStorage
import cloudinary.uploader
# import cloudinary.utils


# ─── Universal Cloudinary Storage ────────────────────────────────────────────

class UniversalCloudinaryStorage(MediaCloudinaryStorage):
    """
    Storage backend that uploads any file type to Cloudinary with the correct
    resource_type (image / video / raw) based on file extension.
    """
    
    def deconstruct(self):
        return ('chat.models.UniversalCloudinaryStorage', [], {})

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
        Strip extension for Cloudinary public_id to avoid double extensions in URLs.
        Cloudinary adds the format extension automatically when requested.
        """
        if '.' in name:
            # Strip the extension from the public_id
            return name.rsplit('.', 1)[0]
        return name

    def _save(self, name, content):
        resource_type = self._get_resource_type(name)
        public_id     = self._get_public_id(name)
        
        # FIX: Normalize backslashes to forward slashes for Cloudinary
        public_id = public_id.replace('\\', '/')
        
        try:
            response = cloudinary.uploader.upload(
                content,
                public_id=public_id,
                resource_type=resource_type,
                overwrite=True,
                invalidate=True,
            )
            
            stored_public_id = response.get('public_id', public_id)
            version          = response.get('version')
            fmt              = response.get('format', '')

            # FIX: For raw files, Cloudinary doesn't return a format. 
            # We must restore the original extension for 'raw' types.
            if resource_type == 'raw':
                extension = name.rsplit('.', 1)[-1] if '.' in name else ''
                if extension and not stored_public_id.lower().endswith(f".{extension.lower()}"):
                    stored_public_id = f"{stored_public_id}.{extension}"

            # Case-insensitive check for extension to avoid double extensions like .JPG.jpg
            if version and fmt and resource_type != 'raw':
                ext = f".{fmt}".lower()
                if not stored_public_id.lower().endswith(ext):
                    return f"v{version}/{stored_public_id}.{fmt}"
                return f"v{version}/{stored_public_id}"
            elif version:
                return f"v{version}/{stored_public_id}"
            
            return stored_public_id

        except Exception as e:
            raise IOError(f"[UniversalCloudinaryStorage] Upload failed for '{name}': {e}") from e

    def _open(self, name, mode='rb'):
        raise NotImplementedError("Opening Cloudinary files directly is not supported.")

    def url(self, name):
        """
        Return the full Cloudinary CDN URL for a stored file.
        """
        if not name: return ''
        if name.startswith('http://') or name.startswith('https://'): return name

        # 1. Determine resource type
        resource_type = self._get_resource_type(name)

        # 2. Build absolute URL with correct resource_type.
        # We keep the 'name' as is because it already contains the version and extension
        # from the _save method (e.g., 'v1778865260/chat_media/1000085395.jpg').
        cloud_name = settings.CLOUDINARY_STORAGE.get('CLOUD_NAME', '')
        
        url = f"https://res.cloudinary.com/{cloud_name}/{resource_type}/upload/{name}"
        
        # 3. Enforce extension for video/audio resources if missing (Cloudinary requirement)
        if resource_type == 'video':
            if not any(url.lower().endswith(ext) for ext in ['.mp4', '.m4a', '.mp3', '.wav', '.aac', '.flac', '.ogg']):
                url = f"{url}.mp4"
            
        return url

    def _extract_public_id(self, name: str) -> str:
        """
        Extract the Cloudinary public_id from a stored name.
        Example: 'v123/path/to/file.jpg' -> 'path/to/file'
        """
        clean_name = name
        # Strip version prefix if exists (e.g., 'v123/')
        if clean_name.startswith('v') and '/' in clean_name:
            parts = clean_name.split('/', 1)
            if parts[0][1:].isdigit():
                clean_name = parts[1]
        
        # Strip extension
        if '.' in clean_name:
            clean_name = clean_name.rsplit('.', 1)[0]
            
        return clean_name

    def exists(self, name):
        try:
            public_id = self._extract_public_id(name)
            resource_type = self._get_resource_type(name)
            cloudinary.uploader.explicit(public_id, type='upload', resource_type=resource_type)
            return True
        except Exception:
            return False

    def delete(self, name):
        try:
            public_id = self._extract_public_id(name)
            resource_type = self._get_resource_type(name)
            cloudinary.uploader.destroy(public_id, resource_type=resource_type)
        except Exception: pass

    def size(self, name):
        return 0

    def get_available_name(self, name, max_length=None):
        return name


def get_universal_storage():
    """
    Return Cloudinary storage if configured in settings, 
    otherwise fallback to local disk storage.
    """
    if getattr(settings, 'CLOUDINARY_STORAGE', {}).get('CLOUD_NAME'):
        return UniversalCloudinaryStorage()
    
    from django.core.files.storage import FileSystemStorage
    return FileSystemStorage()


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
        max_length=255,
        blank=True, null=True,
        storage=get_universal_storage,
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
        max_length=255,
        blank=True, null=True,
        storage=get_universal_storage,
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
        max_length=255,
        storage=get_universal_storage,
    )

    caption    = models.CharField(max_length=255, blank=True, null=True)
    caption_x = models.FloatField(default=0.0)
    caption_y = models.FloatField(default=0.0)
    caption_scale = models.FloatField(default=1.0)
    caption_rotation = models.FloatField(default=0.0)
    created_at = models.DateTimeField(auto_now_add=True)
    restricted_to = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='visible_statuses',
        blank=True
    )

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


# ─── Signals ──────────────────────────────────────────────────────────────────

from django.db.models.signals import post_delete
from django.dispatch import receiver

@receiver(post_delete, sender=Status)
def delete_status_media(sender, instance, **kwargs):
    """
    Robust deletion of media from Cloudinary using path cleaning
    matching the logic used in ChatRoom media.
    """
    if instance.media_file:
        try:
            path = instance.media_file.name
            
            # 1. Remove the version prefix if present (e.g., 'v12345/')
            clean_path = re.sub(r'^v\d+/', '', path)
            
            # 2. Remove extension to get public_id
            public_id = clean_path.rsplit('.', 1)[0]
            
            # 3. Determine resource_type
            resource_type = 'video' if instance.media_type == 'video' else 'image'
            
            print(f"DEBUG: Status Deletion - Path: {path}, Public ID: {public_id}, Type: {resource_type}")
            
            result = cloudinary.uploader.destroy(
                public_id, 
                resource_type=resource_type,
                invalidate=True
            )
            print(f"DEBUG: Cloudinary deletion result: {result}")
        except Exception as e:
            print(f"DEBUG: Failed to delete status media from Cloudinary: {e}")


@receiver(post_delete, sender=Message)
def delete_message_media(sender, instance, **kwargs):
    """
    Delete message media (media_file and thumbnail) from Cloudinary when message is deleted.
    """
    if instance.media_file:
        try:
            path = instance.media_file.name
            clean_path = re.sub(r'^v\d+/', '', path)
            public_id = clean_path.rsplit('.', 1)[0]
            
            # Determine resource_type based on message_type
            resource_type = 'image'
            if instance.message_type in ['video', 'audio']:
                resource_type = 'video'
            elif instance.message_type == 'document':
                resource_type = 'raw'
            
            print(f"DEBUG: Message Deletion - Path: {path}, Public ID: {public_id}, Type: {resource_type}")
            
            result = cloudinary.uploader.destroy(
                public_id, 
                resource_type=resource_type, 
                invalidate=True
            )
            print(f"DEBUG: Cloudinary deletion result: {result}")
        except Exception as e:
            print(f"DEBUG: Failed to delete message media from Cloudinary: {e}")

    if instance.thumbnail:
        try:
            path = instance.thumbnail.name
            clean_path = re.sub(r'^v\d+/', '', path)
            public_id = clean_path.rsplit('.', 1)[0]
            
            print(f"DEBUG: Message Thumbnail Deletion - Path: {path}, Public ID: {public_id}")
            
            result = cloudinary.uploader.destroy(
                public_id, 
                resource_type='image', 
                invalidate=True
            )
            print(f"DEBUG: Cloudinary deletion result: {result}")
        except Exception as e:
            print(f"DEBUG: Failed to delete message thumbnail from Cloudinary: {e}")


# ─── StatusPrivacy ────────────────────────────────────────────────────────────

class StatusPrivacy(models.Model):
    """Stores global default status privacy settings for a user."""
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='status_privacy_settings'
    )
    # If restricted_to is empty, status is public to all contacts by default.
    # If not empty, only these users can see the status by default.
    restricted_to = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='included_in_status_privacies',
        blank=True
    )

    class Meta:
        verbose_name = 'Status Privacy'
        verbose_name_plural = 'Status Privacies'

    def __str__(self):
        return f"Privacy for {self.user.email}"


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