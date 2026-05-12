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
        fields = ('id', 'email', 'username', 'profile_picture', 'display_name',
                  'bio', 'is_verified', 'is_profile_complete', 'last_seen', 'computed_display_name')
        read_only_fields = ('id', 'email', 'is_verified', 'is_profile_complete', 'last_seen', 'computed_display_name')

    def get_profile_picture(self, obj):
        """Return full URL for profile picture."""
        if obj.profile_picture:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.profile_picture.url)
            # Fallback to hardcoded URL if request not available
            return f'http://10.190.93.197:8000{obj.profile_picture.url}'
        return None



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
        profile_picture = validated_data.pop('profile_picture', None)
        if profile_picture:
            instance.profile_picture = profile_picture
        return super().update(instance, validated_data)

class ProfileUpdateSerializer(serializers.ModelSerializer):
    """Serializer for updating user profile with 14-day username change constraint."""
    profile_picture = serializers.SerializerMethodField()

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
        profile_picture = validated_data.pop('profile_picture', None)
        if profile_picture:
            instance.profile_picture = profile_picture
            
        return super().update(instance, validated_data)

    def get_profile_picture(self, obj):
        """Return full URL for profile picture."""
        if obj.profile_picture:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.profile_picture.url)
            # Fallback to hardcoded URL if request not available
            return f'http://10.190.93.197:8000{obj.profile_picture.url}'
        return None
