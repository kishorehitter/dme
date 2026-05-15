"""
Serializers for chat app.
"""
from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.conf import settings
from .models import Conversation, ConversationParticipant, Message, MessageReaction, Status, StatusView

User = get_user_model()


class UserMinimalSerializer(serializers.ModelSerializer):
    """Minimal user info for chat. Hides email for non-owners."""
    display_name = serializers.SerializerMethodField()
    profile_picture = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ('id', 'username', 'profile_picture', 'avatar_sticker', 'display_name', 'last_seen')

    def get_display_name(self, obj):
        """Return custom display_name or username."""
        if obj.display_name:
            return obj.display_name
        if obj.username:
            return obj.username
        return 'Unknown'

    def get_profile_picture(self, obj):
        """Return full clean URL for profile picture."""
        if hasattr(obj, 'clean_profile_picture_url'):
            url = obj.clean_profile_picture_url
            if url:
                # Add a timestamp to bypass client-side caching
                timestamp = int(obj.last_seen.timestamp()) if hasattr(obj, 'last_seen') and obj.last_seen else 0
                return f"{url}?t={timestamp}"
        return None


class StatusViewSerializer(serializers.ModelSerializer):
    viewer_id       = serializers.IntegerField(source='viewer.id',       read_only=True)
    viewer_username = serializers.CharField(source='viewer.username',    read_only=True)
    viewer_avatar   = serializers.SerializerMethodField()
    viewer_avatar_sticker = serializers.CharField(source='viewer.avatar_sticker', read_only=True)
 
    class Meta:
        model  = StatusView
        fields = ['viewer_id', 'viewer_username', 'viewer_avatar', 'viewer_avatar_sticker', 'viewed_at']
 
    def get_viewer_avatar(self, obj):
        if obj.viewer:
            return obj.viewer.clean_profile_picture_url
        return None
 
 
class StatusSerializer(serializers.ModelSerializer):
    username    = serializers.CharField(source='user.username', read_only=True)
    user_avatar = serializers.SerializerMethodField()
    user_avatar_sticker = serializers.CharField(source='user.avatar_sticker', read_only=True)
    media_url   = serializers.SerializerMethodField()
    view_count  = serializers.SerializerMethodField()
    is_viewed   = serializers.SerializerMethodField()
    like_count  = serializers.SerializerMethodField()
    is_liked    = serializers.SerializerMethodField()

    class Meta:
        model  = Status
        fields = [
            'id', 'user_id', 'username', 'user_avatar', 'user_avatar_sticker',
            'media_file', 'media_url', 'media_type',
            'caption', 'created_at', 'view_count',
            'is_viewed', 'like_count', 'is_liked',
        ]

    def get_user_avatar(self, obj):
        if obj.user:
            return obj.user.clean_profile_picture_url
        return None

    def get_media_url(self, obj):
        return obj.clean_media_url

    def get_view_count(self, obj):
        return obj.views.count()

    def get_is_viewed(self, obj):
        request = self.context.get('request')
        if not request: return False
        return obj.views.filter(viewer=request.user).exists()

    def get_like_count(self, obj):
        return obj.likes.count()

    def get_is_liked(self, obj):
        request = self.context.get('request')
        if not request: return False
        return obj.likes.filter(user=request.user).exists()


class MessageSerializer(serializers.ModelSerializer):
    """Serializer for Message model."""
    sender = UserMinimalSerializer(read_only=True)
    sender_id = serializers.IntegerField(source='sender.id', read_only=True)
    reply_to = serializers.SerializerMethodField()
    reactions = serializers.SerializerMethodField()
    media_url = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = (
            'id', 'conversation', 'sender', 'sender_id', 'content', 'message_type',
            'media_file', 'media_url', 'thumbnail', 'is_read', 'delivered_at', 'is_deleted', 'created_at', 'edited_at',
            'reply_to', 'reactions', 'audio_duration'
        )
        read_only_fields = ('id', 'conversation', 'sender', 'sender_id', 'is_read', 'delivered_at', 'is_deleted', 'created_at', 'edited_at', 'audio_duration')
        extra_kwargs = {
            'media_file': {'required': False},
            'content': {'required': False},
        }

    def get_reply_to(self, obj):
        """Return replied message info."""
        if obj.reply_to:
            return {
                'id': obj.reply_to.id,
                'content': obj.reply_to.content,
                'sender': {
                    'id': obj.reply_to.sender.id,
                    'display_name': obj.reply_to.sender.display_name or obj.reply_to.sender.first_name or obj.reply_to.sender.email,
                }
            }
        return None

    def get_reactions(self, obj):
        """Return reactions as a dict of user_id -> emoji."""
        reactions = {}
        for reaction in obj.reactions.all():
            reactions[str(reaction.user.id)] = reaction.emoji
        return reactions

    def get_media_url(self, obj):
        """Return a clean absolute URL using the model's standardized accessor."""
        return obj.clean_media_url

    def create(self, validated_data):
        # Handle media file upload
        request = self.context.get('request')
        if request and request.FILES.get('media_file'):
            file_obj = request.FILES.get('media_file')
            
            # AGGRESSIVE CLEANING: Strip EVERYTHING except the last part of a path
            # This handles cases where the 'name' is a full URL or absolute path
            original_name = file_obj.name
            clean_name = original_name.replace('\\', '/').split('/')[-1]
            
            # Ensure we have an extension if it's missing (Cloudinary needs it for resource type)
            if '.' not in clean_name:
                message_type = validated_data.get('message_type', 'image')
                ext = 'mp4' if message_type == 'video' else 'm4a' if message_type == 'audio' else 'jpg'
                clean_name = f"{clean_name}.{ext}"
            
            file_obj.name = clean_name
            validated_data['media_file'] = file_obj
        
        # Handle reply_to
        reply_to_id = request.data.get('reply_to') if request else None
        if reply_to_id:
            try:
                validated_data['reply_to'] = Message.objects.get(id=reply_to_id)
            except Message.DoesNotExist:
                pass
        
        # Set default content for media messages
        if not validated_data.get('content') and validated_data.get('media_file'):
            message_type = validated_data.get('message_type', 'text')
            if message_type == 'audio':
                validated_data['content'] = 'Voice note'
            elif message_type == 'image':
                validated_data['content'] = 'Image'
            elif message_type == 'document':
                validated_data['content'] = 'Document'
            elif message_type == 'video':
                validated_data['content'] = 'Video'
        
        # Sender and conversation are set by the view
        return super().create(validated_data)


class MessageReactionSerializer(serializers.ModelSerializer):
    """Serializer for MessageReaction model."""
    user = UserMinimalSerializer(read_only=True)
    
    class Meta:
        model = MessageReaction
        fields = ('id', 'message', 'user', 'emoji', 'created_at')
        read_only_fields = ('id', 'user', 'created_at')


class ConversationParticipantSerializer(serializers.ModelSerializer):
    """Serializer for ConversationParticipant model."""
    user = UserMinimalSerializer(read_only=True)
    
    class Meta:
        model = ConversationParticipant
        fields = ('id', 'conversation', 'user', 'joined_at', 'last_read_message', 'is_admin')


class ConversationSerializer(serializers.ModelSerializer):
    """Serializer for conversation model."""
    participants = ConversationParticipantSerializer(many=True, read_only=True)
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    profile_picture = serializers.SerializerMethodField()
    
    class Meta:
        model = Conversation
        fields = (
            'id', 'name', 'description', 'is_group', 'created_at', 'updated_at', 'created_by',
            'profile_picture', 'participants', 'last_message', 'unread_count'
        )
        read_only_fields = ('id', 'created_at', 'updated_at', 'created_by')
    
    def get_profile_picture(self, obj):
        return obj.clean_profile_picture_url
    
    def get_last_message(self, obj):
        last_msg = obj.messages.filter(is_deleted=False).order_by('-created_at').first()
        if last_msg:
            return MessageSerializer(last_msg).data
        return None
    
    def get_unread_count(self, obj):
        request = self.context.get('request')
        if not request:
            return 0
        
        participant = obj.participants.filter(user=request.user).first()
        if not participant:
            return 0
        
        last_read = participant.last_read_message
        if last_read:
            return obj.messages.filter(
                created_at__gt=last_read.created_at,
                is_deleted=False
            ).exclude(sender=request.user).count()
        else:
            return obj.messages.filter(is_deleted=False).exclude(sender=request.user).count()


class ConversationCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating a new conversation."""
    participant_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False
    )
    
    class Meta:
        model = Conversation
        fields = ('id', 'name', 'description', 'is_group', 'participant_ids', 'profile_picture')
    
    def create(self, validated_data):
        participant_ids = validated_data.pop('participant_ids', [])
        is_group = validated_data.get('is_group', False)
        request = self.context.get('request')
        
        # Extract created_by if it was passed via serializer.save() or fallback to request.user
        created_by = validated_data.pop('created_by', request.user if request else None)
        
        # Clean profile picture filename
        profile_picture = validated_data.get('profile_picture')
        if profile_picture:
            if '/' in profile_picture.name: profile_picture.name = profile_picture.name.split('/')[-1]
            if '\\' in profile_picture.name: profile_picture.name = profile_picture.name.split('\\')[-1]

        # Create conversation
        conversation = Conversation.objects.create(
            created_by=created_by,
            **validated_data
        )
        
        # Add participants
        if is_group:
            # For groups, always add creator as admin
            if request and request.user:
                if request.user.id not in participant_ids:
                    # Insert at the beginning so creator is the first participant
                    participant_ids.insert(0, request.user.id)
            
            for user_id in participant_ids:
                ConversationParticipant.objects.create(
                    conversation=conversation,
                    user_id=user_id,
                    is_admin=(user_id == (request.user.id if request and request.user else None))
                )
        else:
            # For one-on-one
            if participant_ids:
                # Add creator
                if request and request.user:
                    ConversationParticipant.objects.get_or_create(
                        conversation=conversation,
                        user=request.user,
                        defaults={'is_admin': True}
                    )
                # Add other participant
                for user_id in participant_ids:
                    ConversationParticipant.objects.get_or_create(
                        conversation=conversation,
                        user_id=user_id,
                        defaults={'is_admin': True}
                    )
            elif request and request.user:
                ConversationParticipant.objects.create(
                    conversation=conversation,
                    user=request.user,
                    is_admin=True
                )
        
        return conversation


class ConversationListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for conversation list."""
    other_user = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    profile_picture = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = (
            'id', 'name', 'description', 'is_group', 'profile_picture', 'updated_at',
            'other_user', 'last_message', 'unread_count'
        )

    def get_profile_picture(self, obj):
        return obj.clean_profile_picture_url

    def get_other_user(self, obj):
        if obj.is_group:
            return None
        request = self.context.get('request')
        if not request:
            return None
        other = obj.participants.exclude(user=request.user).select_related('user').first()
        if other:
            # Pass context=self.context so UserMinimalSerializer can build absolute URLs
            return UserMinimalSerializer(other.user, context=self.context).data
        return None

    def get_last_message(self, obj):
        request = self.context.get('request')
        # Filter out messages that are deleted OR cleared by current user
        messages_queryset = obj.messages.filter(is_deleted=False)
        if request:
            messages_queryset = messages_queryset.exclude(cleared_by=request.user)
        
        last_msg = messages_queryset.order_by('-created_at').first()
        if last_msg:
            return {
                'id': last_msg.id,
                'content': last_msg.content,
                'message_type': last_msg.message_type,
                'created_at': last_msg.created_at,
                'sender_id': last_msg.sender_id,
            }
        return None

    def get_unread_count(self, obj):
        request = self.context.get('request')
        if not request:
            return 0

        participant = obj.participants.filter(user=request.user).first()
        if not participant:
            return 0

        last_read = participant.last_read_message
        if last_read:
            return obj.messages.filter(
                created_at__gt=last_read.created_at,
                is_deleted=False
            ).exclude(sender=request.user).count()
        else:
            return obj.messages.filter(is_deleted=False).exclude(sender=request.user).count()
