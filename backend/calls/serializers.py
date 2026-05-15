"""
Serializers for calls app.
"""
from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Call, GroupCall, GroupCallParticipant

User = get_user_model()


class CallSerializer(serializers.ModelSerializer):
    """Serializer for Call model."""
    caller_name = serializers.SerializerMethodField()
    receiver_name = serializers.SerializerMethodField()
    caller_avatar = serializers.SerializerMethodField()

    class Meta:
        model = Call
        fields = (
            'id', 'caller', 'caller_name', 'caller_avatar',
            'receiver', 'receiver_name', 'call_type', 'status',
            'started_at', 'ended_at', 'duration'
        )
        read_only_fields = fields

    def get_caller_name(self, obj):
        """Get caller's display name."""
        if obj.caller:
            return obj.caller.display_name or obj.caller.email
        return None

    def get_receiver_name(self, obj):
        """Get receiver's display name."""
        if obj.receiver:
            return obj.receiver.display_name or obj.receiver.email
        return None

    def get_caller_avatar(self, obj):
        """Get caller's avatar URL."""
        if obj.caller and obj.caller.profile_picture:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.caller.profile_picture.url)
        return None


class CallInitiateSerializer(serializers.Serializer):
    """Serializer for initiating a call."""
    receiver_id = serializers.IntegerField()
    call_type = serializers.ChoiceField(choices=['audio', 'video'], default='audio')
    offer_sdp = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_receiver_id(self, value):
        """Validate receiver exists."""
        if not User.objects.filter(id=value).exists():
            raise serializers.ValidationError("Receiver not found")
        if value == self.context['request'].user.id:
            raise serializers.ValidationError("Cannot call yourself")
        return value


class CallEndSerializer(serializers.Serializer):
    """Serializer for ending a call."""
    call_id = serializers.IntegerField()

    def validate_call_id(self, value):
        """Validate call exists and user is participant."""
        try:
            call = Call.objects.get(id=value)
            user = self.context['request'].user
            if call.caller != user and call.receiver != user:
                raise serializers.ValidationError("Not authorized to end this call")
            return value
        except Call.DoesNotExist:
            raise serializers.ValidationError("Call not found")


class CallHistorySerializer(serializers.ModelSerializer):
    """Serializer for call history."""
    other_party = serializers.SerializerMethodField()
    other_party_avatar = serializers.SerializerMethodField()
    other_party_avatar_sticker = serializers.SerializerMethodField()
    is_caller = serializers.SerializerMethodField()

    class Meta:
        model = Call
        fields = (
            'id', 'other_party', 'other_party_avatar', 'other_party_avatar_sticker', 'call_type',
            'status', 'started_at', 'ended_at', 'duration', 'is_caller'
        )
        read_only_fields = fields

    def get_other_party(self, obj):
        """Get the other party's details."""
        user = self.context['request'].user
        other = obj.receiver if obj.caller == user else obj.caller
        if other:
            return {
                'id': other.id,
                'name': other.display_name or other.email,
                'email': other.email,
            }
        return None

    def get_other_party_avatar(self, obj):
        """Get other party's avatar URL."""
        user = self.context['request'].user
        other = obj.receiver if obj.caller == user else obj.caller
        if other:
            return other.clean_profile_picture_url
        return None

    def get_other_party_avatar_sticker(self, obj):
        """Get other party's avatar sticker."""
        user = self.context['request'].user
        other = obj.receiver if obj.caller == user else obj.caller
        return other.avatar_sticker if other else None

    def get_is_caller(self, obj):
        """Check if current user was the caller."""
        return obj.caller == self.context['request'].user


class GroupCallParticipantSerializer(serializers.ModelSerializer):
    """Serializer for GroupCallParticipant model."""
    user = serializers.SerializerMethodField()

    class Meta:
        model = GroupCallParticipant
        fields = ('user', 'joined_at', 'left_at')

    def get_user(self, obj):
        from chat.serializers import UserMinimalSerializer
        return UserMinimalSerializer(obj.user, context=self.context).data


class GroupCallSerializer(serializers.ModelSerializer):
    """Serializer for GroupCall model."""
    participants = GroupCallParticipantSerializer(many=True, read_only=True)
    initiator_name = serializers.CharField(source='initiator.display_name', read_only=True)

    class Meta:
        model = GroupCall
        fields = (
            'id', 'conversation', 'initiator', 'initiator_name',
            'call_type', 'is_active', 'started_at', 'ended_at',
            'room_id', 'participants'
        )
        read_only_fields = fields


class GroupCallInitiateSerializer(serializers.Serializer):
    """Serializer for initiating a group call."""
    conversation_id = serializers.IntegerField()
    call_type = serializers.ChoiceField(choices=['audio', 'video'], default='audio')

    def validate_conversation_id(self, value):
        from chat.models import Conversation
        if not Conversation.objects.filter(id=value).exists():
            raise serializers.ValidationError("Conversation not found")
        return value
