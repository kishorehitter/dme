"""
Models for accounts app - Custom User model with email OTP authentication.
"""
import random
import string
from django.db import models
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.utils import timezone
from datetime import timedelta
from django.conf import settings
from cloudinary_storage.storage import MediaCloudinaryStorage

class UserManager(BaseUserManager):
    """Custom user manager that uses email as the username."""
    
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('Email address is required')
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user
    
    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('is_verified', True)
        
        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True')
        
        return self.create_user(email, password, **extra_fields)

class User(AbstractUser):
    """Custom User model using email as unique identifier and unique username."""

    email = models.EmailField(unique=True)
    username = models.CharField(max_length=150, unique=True, help_text="Unique username for search")
    # phone_number = models.CharField(max_length=20, blank=True, null=True)
    profile_picture = models.ImageField(upload_to='profile_pics/', max_length=255, blank=True, null=True, storage=MediaCloudinaryStorage())
    avatar_sticker = models.CharField(max_length=10, blank=True, null=True, help_text="Emoji avatar sticker")
    display_name = models.CharField(max_length=100, blank=True, null=True, help_text="Public profile name (can include emojis)")
    bio = models.CharField(max_length=255, blank=True, default='Hey there! I am using DME')
    is_verified = models.BooleanField(default=False)
    is_profile_complete = models.BooleanField(default=False, help_text="Whether the user has completed onboarding")
    last_username_change = models.DateTimeField(null=True, blank=True)
    last_seen = models.DateTimeField(null=True, blank=True, help_text="Last time user disconnected from WebSocket")

    @property
    def clean_profile_picture_url(self):
        """Standardized absolute URL accessor that handles various mangled formats."""
        if not self.profile_picture:
            return None
        
        try:
            url = self.profile_picture.url
            if not url: return None
            
            if 'cloudinary.com' in url:
                last_https = url.rfind('https:/')
                if last_https > 0:
                    url = url[last_https:]
                
                if url.startswith('https:/') and not url.startswith('https://'):
                    url = url.replace('https:/', 'https://', 1)
            
            return url
        except Exception:
            return None

    def save(self, *args, **kwargs):
        # Sanitize profile_picture path if it contains duplicated or mangled prefixes
        if self.profile_picture and self.profile_picture.name:
            name = self.profile_picture.name
            if 'https:/' in name:
                last_idx = name.rfind('https:/')
                if last_idx > 0:
                    name = name[last_idx:]
                
                for prefix in ['profile_pics/']:
                    if prefix in name:
                        name = name[name.find(prefix):]
                        break
                self.profile_picture.name = name

        super().save(*args, **kwargs)

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    def __str__(self):
        return self.email

    @property
    def status(self):
        """Backward compatibility for status field."""
        return self.bio

    @status.setter
    def status(self, value):
        self.bio = value

    @property
    def computed_display_name(self):
        """Return custom display_name or first name + last name or username or email."""
        if self.display_name:
            return self.display_name
        if self.first_name or self.last_name:
            return f"{self.first_name} {self.last_name}".strip()
        if self.username:
            return self.username
        return self.email

    class Meta:
        verbose_name = 'User'
        verbose_name_plural = 'Users'

class OTP(models.Model):
    """Model for storing email OTP codes."""
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='otps')
    code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)
    
    def save(self, *args, **kwargs):
        if not self.code:
            self.code = self.generate_code()
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(minutes=settings.OTP_EXPIRY_MINUTES)
        super().save(*args, **kwargs)
    
    @staticmethod
    def generate_code():
        """Generate a random 6-digit OTP code."""
        return ''.join(random.choices(string.digits, k=settings.OTP_LENGTH))
    
    @property
    def is_expired(self):
        """Check if OTP has expired."""
        return timezone.now() > self.expires_at
    
    @property
    def is_valid(self):
        """Check if OTP is still valid."""
        return not self.is_used and not self.is_expired
    
    def __str__(self):
        return f"OTP for {self.user.email} - {self.code}"

    class Meta:
        verbose_name = 'OTP'
        verbose_name_plural = 'OTPs'
        ordering = ['-created_at']


class UserBlock(models.Model):
    """Model for tracking blocked users."""
    
    blocker = models.ForeignKey(User, on_delete=models.CASCADE, related_name='blocking_users')
    blocked = models.ForeignKey(User, on_delete=models.CASCADE, related_name='blocked_by_users')
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        verbose_name = 'User Block'
        verbose_name_plural = 'User Blocks'
        unique_together = ['blocker', 'blocked']
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.blocker.email} blocked {self.blocked.email}"


class FCMDevice(models.Model):
    """Model for storing Firebase Cloud Messaging device tokens."""

    PLATFORM_CHOICES = [
        ('ios', 'iOS'),
        ('android', 'Android'),
        ('web', 'Web'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='fcm_devices')
    device_id = models.CharField(max_length=255, help_text="Unique device identifier")
    registration_token = models.TextField(help_text="FCM registration token")
    platform = models.CharField(max_length=10, choices=PLATFORM_CHOICES)
    is_active = models.BooleanField(default=True, help_text="Whether the device is still active")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'FCM Device'
        verbose_name_plural = 'FCM Devices'
        unique_together = ['user', 'device_id']
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.user.email} - {self.platform} ({self.device_id[:20]}...)"


class ProfileInteraction(models.Model):
    """Tracks when a user views another user's profile to enable status visibility."""
    viewer = models.ForeignKey(User, on_delete=models.CASCADE, related_name='profile_views_sent')
    profile_owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='profile_views_received')
    viewed_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        verbose_name = 'Profile Interaction'
        verbose_name_plural = 'Profile Interactions'
        unique_together = ['viewer', 'profile_owner']
        ordering = ['-viewed_at']
    
    def __str__(self):
        return f"{self.viewer.email} viewed {self.profile_owner.email}"
