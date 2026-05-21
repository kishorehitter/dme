"""
Serializers for accounts app.
"""
from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.conf import settings
from django.utils import timezone
from .models import OTP

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """Serializer for User model."""
    profile_picture = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ('id', 'email', 'username', 'profile_picture', 'avatar_sticker', 'display_name',
                  'bio', 'is_verified', 'is_profile_complete', 'last_seen', 'computed_display_name', 'last_username_change')
        read_only_fields = ('id', 'email', 'is_verified', 'is_profile_complete', 'last_seen', 'computed_display_name', 'last_username_change')

    def get_profile_picture(self, obj):
        """Return standardized absolute URL for profile picture."""
        return obj.clean_profile_picture_url



class UsernameCheckSerializer(serializers.Serializer):
    """Serializer for checking username availability."""
    username = serializers.RegexField(
        regex=r'^[\w.@+-]+$',
        max_length=150,
        min_length=3,
        error_messages={'invalid': 'Username can only contain letters, numbers, and @/./+/-/_ characters.'}
    )

    def validate_username(self, value):
        value = value.lower()
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("This username is already taken.")
        return value


class ProfileSetupSerializer(serializers.ModelSerializer):
    """Serializer for initial profile setup/onboarding."""
    
    class Meta:
        model = User
        fields = ('username', 'display_name', 'bio', 'avatar_sticker', 'profile_picture')
        extra_kwargs = {
            'username': {'required': True},
            'display_name': {'required': True},
            'profile_picture': {'required': False, 'allow_null': True},
        }

    def validate_username(self, value):
        value = value.lower()
        if User.objects.filter(username=value).exclude(id=self.instance.id).exists():
            raise serializers.ValidationError("This username is already taken.")
        return value

    def update(self, instance, validated_data):
        validated_data['is_profile_complete'] = True
        validated_data['last_username_change'] = timezone.now()
        
        # Handle profile picture update
        if 'profile_picture' in validated_data:
            profile_picture = validated_data.pop('profile_picture')
            if profile_picture:
                if '/' in profile_picture.name: profile_picture.name = profile_picture.name.split('/')[-1]
                if '\\' in profile_picture.name: profile_picture.name = profile_picture.name.split('\\')[-1]
                instance.profile_picture = profile_picture
            else:
                instance.profile_picture = None
                
        return super().update(instance, validated_data)

class ProfileUpdateSerializer(serializers.ModelSerializer):
    """Serializer for updating user profile with 14-day username change constraint."""
    profile_picture = serializers.ImageField(required=False, allow_null=True)

    class Meta:
        model = User
        fields = ('username', 'display_name', 'bio', 'profile_picture', 'avatar_sticker')

    def validate_username(self, value):
        value = value.lower()
        if value == self.instance.username:
            return value
            
        if User.objects.filter(username=value).exclude(id=self.instance.id).exists():
            raise serializers.ValidationError("This username is already taken.")
            
        if self.instance.last_username_change:
            days_since_change = (timezone.now() - self.instance.last_username_change).days
            if days_since_change < 14:
                raise serializers.ValidationError(f"You can only change your username once every 14 days. Please wait {14 - days_since_change} more days.")
        
        return value

    def update(self, instance, validated_data):
        if 'username' in validated_data and validated_data['username'] != instance.username:
            validated_data['last_username_change'] = timezone.now()
        
        # Handle profile picture update from form data if present
        if 'profile_picture' in validated_data:
            profile_picture = validated_data.pop('profile_picture')
            if profile_picture:
                if '/' in profile_picture.name: profile_picture.name = profile_picture.name.split('/')[-1]
                if '\\' in profile_picture.name: profile_picture.name = profile_picture.name.split('\\')[-1]
                instance.profile_picture = profile_picture
            else:
                instance.profile_picture = None
            
        return super().update(instance, validated_data)
