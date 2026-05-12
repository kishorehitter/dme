"""
Views for calls app - REST API endpoints.

Fixed:
- CallInitiateView._send_call_notification now includes:
    * conversation_id  → so receiver's IncomingCallScreen/CallScreen gets it
    * caller_avatar    → URL of caller's profile picture for IncomingCallScreen
- CallAcceptView: added transaction.atomic and select_for_update
- CallEndView: added fallback to detect answered calls via answer_sdp
"""
from accounts.models import User
from django.db import models, transaction
from rest_framework import status, permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils import timezone
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from livekit import api as livekit_api
from django.conf import settings
import os
import uuid
from .models import Call, GroupCall, GroupCallParticipant
from .serializers import (
    CallSerializer,
    CallInitiateSerializer,
    CallEndSerializer,
    CallHistorySerializer,
    GroupCallInitiateSerializer,
)
from notifications.fcm_service import FCMService
from chat.models import Conversation


def generate_livekit_token(user, room_name):
    """Generate a LiveKit access token for a user in a given room."""
    token = livekit_api.AccessToken(
        api_key=settings.LIVEKIT_API_KEY,
        api_secret=settings.LIVEKIT_API_SECRET,
    )
    token.with_identity(str(user.id))
    token.with_name(user.display_name or user.email)
    token.with_grants(livekit_api.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
    ))
    return token.to_jwt()


def get_profile_picture_url(user, request=None):
    """
    Return the full absolute URL for a user's profile picture.
    Falls back to None if not set.
    """
    if not user.profile_picture:
        return None
    try:
        url = user.profile_picture.url
        # Make absolute if we have a request context
        if request and not url.startswith('http'):
            return request.build_absolute_uri(url)
        # Fallback: prepend LIVEKIT_URL domain or your media base
        if not url.startswith('http'):
            base = getattr(settings, 'MEDIA_BASE_URL', settings.LIVEKIT_URL.rstrip('/'))
            return f"{base}{url}"
        return url
    except Exception:
        return None


def get_conversation_id_for_call(caller, receiver):
    """
    Find the existing 1-on-1 conversation between caller and receiver.
    Returns conversation ID as string, or None.
    """
    try:
        conv = (
            Conversation.objects
            .filter(is_group=False)
            .filter(participants__user=caller)
            .filter(participants__user=receiver)
            .distinct()
            .first()
        )
        return str(conv.id) if conv else None
    except Exception:
        return None


class CallInitiateView(APIView):
    """
    Initiate a 1-to-1 call.
    Creates call record, sends FCM to receiver, returns LiveKit token to caller.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = CallInitiateSerializer(
            data=request.data,
            context={'request': request}
        )

        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        receiver_id = serializer.validated_data['receiver_id']
        call_type   = serializer.validated_data['call_type']

        try:
            receiver = User.objects.get(id=receiver_id)
        except User.DoesNotExist:
            return Response({'error': 'Receiver not found'}, status=status.HTTP_404_NOT_FOUND)

        # Create call record
        call = Call.objects.create(
            caller=request.user,
            receiver=receiver,
            call_type=call_type,
            status='ringing',
        )

        # Room name based on call ID
        room_name = f"one_to_one_{call.id}"

        # Generate LiveKit token for caller
        try:
            token = generate_livekit_token(request.user, room_name)
        except Exception as e:
            print(f"[CallInitiate] LiveKit token error: {e}")
            return Response(
                {'error': f'Failed to generate token: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        # Send FCM notification to receiver
        self._send_call_notification(
            request=request,
            receiver=receiver,
            caller=request.user,
            call_id=call.id,
            call_type=call_type,
            room_name=room_name,
        )

        return Response({
            'message':    'Call initiated',
            'call_id':    call.id,
            'room_name':  room_name,
            'token':      token,
            'server_url': settings.LIVEKIT_URL,
        }, status=status.HTTP_201_CREATED)

    def _send_call_notification(self, request, receiver, caller, call_id, call_type, room_name):
        """Send FCM data-only notification for incoming call."""
        try:
            caller_name = caller.display_name or caller.email

            # Look up conversation_id so receiver's CallScreen gets it
            conversation_id = get_conversation_id_for_call(caller, receiver)

            # Build caller avatar URL
            caller_avatar = get_profile_picture_url(caller, request)

            data = {
                'type':            'incoming_call',
                'call_id':         str(call_id),
                'caller_id':       str(caller.id),
                'caller_name':     caller_name,
                'call_type':       call_type,
                'room_name':       room_name,
                'notif_title':     f'Incoming {call_type} call',
                'notif_body':      caller_name,
            }

            # Only include if available (FCM data values must be strings)
            if conversation_id:
                data['conversation_id'] = conversation_id
            if caller_avatar:
                data['caller_avatar'] = caller_avatar

            FCMService.send_to_user(receiver, None, data)
            print(f"   📱 Sent call notification to {receiver.email} (call_id={call_id})")
        except Exception as e:
            print(f"   ❌ Error sending call notification: {e}")


class GroupCallInitiateView(APIView):
    """
    Initiate a group call via LiveKit.
    Creates group call record, sends FCM to all participants, returns token to initiator.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = GroupCallInitiateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        conversation_id = serializer.validated_data['conversation_id']
        call_type       = serializer.validated_data['call_type']

        try:
            conversation = Conversation.objects.get(id=conversation_id)
        except Conversation.DoesNotExist:
            return Response({'error': 'Conversation not found'}, status=status.HTTP_404_NOT_FOUND)

        if not conversation.participants.filter(user=request.user).exists():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)

        # Generate a truly unique room name
        timestamp = int(timezone.now().timestamp())
        unique_suffix = uuid.uuid4().hex[:8]
        room_name = f"group_{conversation_id}_{timestamp}_{unique_suffix}"

        # Create group call record – room_id is now unique
        group_call = GroupCall.objects.create(
            conversation=conversation,
            initiator=request.user,
            call_type=call_type,
            room_id=room_name,
            is_active=True,
        )

        # Add initiator as first participant
        GroupCallParticipant.objects.create(
            group_call=group_call,
            user=request.user,
        )

        # Generate LiveKit token using the unique room name
        try:
            token = generate_livekit_token(request.user, room_name)
        except Exception as e:
            print(f"[GroupCall] LiveKit token error: {e}")
            # Rollback created group call
            group_call.delete()
            return Response(
                {'error': f'Failed to generate token: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        # Send FCM to all other participants
        self._send_group_call_notifications(group_call, request.user)

        return Response({
            'message':    'Group call initiated',
            'call_id':    group_call.id,
            'room_name':  room_name,
            'token':      token,
            'server_url': settings.LIVEKIT_URL,
        }, status=status.HTTP_201_CREATED)

    def _send_group_call_notifications(self, group_call, initiator):
        """
        Send FCM notification to all group members except the initiator.
        """
        participants = group_call.conversation.participants.exclude(user=initiator)
        initiator_name = initiator.display_name or initiator.email

        for participant in participants:
            try:
                FCMService.send_group_call_notification(
                    recipient=participant.user,
                    initiator_name=initiator_name,
                    initiator_id=initiator.id,
                    call_id=group_call.id,
                    room_id=group_call.room_id,
                    conversation=group_call.conversation, # Pass conversation object
                    call_type=group_call.call_type,
                )
            except Exception as e:
                print(f"   ❌ Error sending group call notification to {participant.user.email}: {e}")


class LiveKitTokenView(APIView):
    """
    Generate a LiveKit token for joining an existing call.
    Used by receiver when accepting an incoming call notification.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        print(f"[LiveKit] === TOKEN REQUEST ===")
        print(f"[LiveKit] User: {request.user.id} ({request.user.email})")
        print(f"[LiveKit] Data: {request.data}")

        call_id         = request.data.get('call_id')
        room_name       = request.data.get('room_name')
        conversation_id = request.data.get('conversation_id')
        receiver_id     = request.data.get('receiver_id')

        if not any([call_id, room_name, conversation_id, receiver_id]):
            return Response(
                {'error': 'Provide call_id, room_name, conversation_id, or receiver_id'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            if room_name:
                final_room = room_name
                print(f"[LiveKit] Using provided room_name: {final_room}")

            elif call_id:
                try:
                    call = Call.objects.get(id=call_id)
                except Call.DoesNotExist:
                    return Response({'error': 'Call not found'}, status=status.HTTP_404_NOT_FOUND)

                if call.caller != request.user and call.receiver != request.user:
                    return Response({'error': 'Not authorized'}, status=status.HTTP_403_FORBIDDEN)

                final_room = f"one_to_one_{call.id}"
                print(f"[LiveKit] 1-on-1 room: {final_room}")

            elif conversation_id:
                # Find the active group call for this conversation
                group_call = GroupCall.objects.filter(
                    conversation_id=conversation_id,
                    is_active=True
                ).order_by('-started_at').first()

                if not group_call:
                    return Response({'error': 'No active group call found'}, status=status.HTTP_404_NOT_FOUND)

                if not group_call.conversation.participants.filter(user=request.user).exists():
                    return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)

                final_room = group_call.room_id
                print(f"[LiveKit] Group call room: {final_room}")

                # Add user to participants if not already there
                GroupCallParticipant.objects.get_or_create(
                    group_call=group_call,
                    user=request.user,
                )

            elif receiver_id:
                call = Call.objects.filter(
                    models.Q(caller=request.user, receiver_id=receiver_id) |
                    models.Q(caller_id=receiver_id, receiver=request.user)
                ).order_by('-started_at').first()

                if not call:
                    return Response({'error': 'No call found between users'}, status=status.HTTP_404_NOT_FOUND)
                
                # ✅ NEW: Verify call is still active
                if call.status not in ['ringing', 'accepted', 'connected']:
                    return Response({'error': 'Call is not active'}, status=status.HTTP_400_BAD_REQUEST)

                final_room = f"one_to_one_{call.id}"
                print(f"[LiveKit] Fallback room: {final_room}")

            token = generate_livekit_token(request.user, final_room)
            print(f"[LiveKit] Token generated for room: {final_room}")

            return Response({
                'token':      token,
                'room_name':  final_room,
                'server_url': settings.LIVEKIT_URL,
            })

        except Exception as e:
            print(f"[LiveKit] ERROR: {e}")
            import traceback
            traceback.print_exc()
            return Response(
                {'error': f'Server error: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class JoinGroupCallView(APIView):
    """Join an active group call."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, call_id):
        try:
            group_call = GroupCall.objects.get(id=call_id, is_active=True)
        except GroupCall.DoesNotExist:
            return Response({'error': 'Active group call not found'}, status=status.HTTP_404_NOT_FOUND)

        if not group_call.conversation.participants.filter(user=request.user).exists():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)

        GroupCallParticipant.objects.get_or_create(
            group_call=group_call,
            user=request.user,
        )

        return Response({
            'message':   'Joined group call',
            'room_name': group_call.room_id,
        })


class CallEndView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        call_id = request.data.get('call_id')
        if not call_id:
            return Response({'error': 'call_id required'}, status=400)

        try:
            call = Call.objects.get(id=call_id)
        except Call.DoesNotExist:
            return Response({'error': 'Call not found'}, status=404)

        if call.caller != request.user and call.receiver != request.user:
            return Response({'error': 'Not authorized'}, status=403)

        # ✅ NEW: Actually calculate duration before ending
        if call.ended_at:
            duration = int((call.ended_at - call.started_at).total_seconds())
        else:
            duration = 0

        # Safety: If call has answer_sdp OR duration > 2 seconds, it was answered
        was_answered = call.status in ['accepted', 'connected'] or (call.answer_sdp and duration >= 3)
        # ✅ FIX: was_missed should be True if it was never answered and was still ringing/initiated
        # We exclude 'rejected' here because CallRejectView now sends the notification immediately.
        was_missed = not was_answered and call.status in ['ringing', 'initiated']

        if was_missed:
            print(f"⚠️ Call {call.id} marked as missed (status={call.status}, duration={duration})")
        else:
            print(f"✅ Call {call.id} was answered (status={call.status}, duration={duration}) – skipping missed notification")

        call.end_call()  # sets status to 'ended'

        # Notify both parties via WebSocket
        try:
            channel_layer = get_channel_layer()
            for user_id in [call.caller.id, call.receiver.id]:
                async_to_sync(channel_layer.group_send)(
                    f'user_{user_id}',
                    {
                        'type': 'call_end', 
                        'call_id': call.id,
                        'ended_by': 'local' if user_id == request.user.id else 'remote',  # ✅ Add this
                    }
                )
            print(f"   📡 Broadcasted call_end for call {call.id}")
        except Exception as e:
            print(f"   ⚠️ WebSocket broadcast error: {e}")

        # Only send missed notification if truly missed (no answer, no duration)
        if was_missed:
            try:
                caller_name = call.caller.display_name or call.caller.email
                
                # ✅ Get conversation_id and avatar for proper notification display
                conversation_id = get_conversation_id_for_call(call.caller, call.receiver)
                caller_avatar = get_profile_picture_url(call.caller, request)
                
                FCMService.send_missed_call_notification(
                    recipient=call.receiver,
                    caller_name=caller_name,
                    caller_id=call.caller.id,
                    call_id=call.id,
                    call_type=call.call_type,
                    conversation_id=conversation_id,
                    caller_avatar=caller_avatar,
                )
            except Exception as e:
                print(f"   ❌ Missed call notification error: {e}")
        else:
            # ✅ If NOT missed (e.g. answered or rejected), send cancel_call to ensure notification is dismissed
            try:
                if call.receiver != request.user:
                    FCMService.send_cancel_call_notification(call.receiver, call.id)
            except Exception as e:
                print(f"   ❌ Cancel call notification error: {e}")

        return Response({
            'message':  'Call ended',
            'call_id':  call.id,
            'duration': call.duration,
        })
    
class CallRejectView(APIView):
    """Reject an incoming call."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        call_id = request.data.get('call_id')
        if not call_id:
            return Response({'error': 'call_id required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            call = Call.objects.get(id=call_id)
        except Call.DoesNotExist:
            return Response({'error': 'Call not found'}, status=status.HTTP_404_NOT_FOUND)

        if call.receiver != request.user:
            return Response({'error': 'Not authorized'}, status=status.HTTP_403_FORBIDDEN)

        if call.status in ['ringing', 'initiated']:
            call.mark_missed()
            # ✅ Send missed call notification IMMEDIATELY on reject-while-ringing/initiated
            try:
                caller_name = call.caller.display_name or call.caller.email
                conversation_id = get_conversation_id_for_call(call.caller, call.receiver)
                caller_avatar = get_profile_picture_url(call.caller, request)

                FCMService.send_missed_call_notification(
                    recipient=call.receiver,
                    caller_name=caller_name,
                    caller_id=call.caller.id,
                    call_id=call.id,
                    call_type=call.call_type,
                    conversation_id=conversation_id,
                    caller_avatar=caller_avatar,
                )
            except Exception as e:
                print(f"   ❌ Missed call notification error in reject: {e}")
        else:
            call.reject_call()
            # ✅ Still send cancel_call if it wasn't ringing (e.g. accepted elsewhere)
            try:
                FCMService.send_cancel_call_notification(call.receiver, call.id)
            except Exception as e:
                print(f"   ❌ Cancel call notification error in reject: {e}")

        # Notify caller
        try:
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f'user_{call.caller.id}',
                {'type': 'call_rejected', 'call_id': call.id}
            )
            print(f"   📡 Sent call_rejected to caller {call.caller.id}")
        except Exception as e:
            print(f"   ⚠️ WebSocket broadcast error: {e}")

        return Response({'message': 'Call rejected', 'call_id': call.id})


class CallHistoryView(APIView):
    """Get call history for current user."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        calls = Call.objects.filter(
            models.Q(caller=request.user) | models.Q(receiver=request.user)
        ).select_related('caller', 'receiver').order_by('-started_at')[:50]

        serializer = CallHistorySerializer(
            calls, many=True, context={'request': request}
        )
        return Response(serializer.data)


class CallAcceptView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        call_id = request.data.get('call_id')
        if not call_id:
            return Response({'error': 'call_id required'}, status=400)

        try:
            call = Call.objects.select_for_update().get(id=call_id)
        except Call.DoesNotExist:
            return Response({'error': 'Call not found'}, status=404)

        if call.receiver != request.user:
            return Response({'error': 'Not authorized'}, status=403)

        if call.status != 'ringing':
            return Response({'error': 'Call is not ringing'}, status=400)

        call.status = 'accepted'
        call.save(update_fields=['status'])
        print(f"✅ Call {call_id} status updated to 'accepted'")

        # Notify caller via WebSocket
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'user_{call.caller.id}',
            {'type': 'call_accepted', 'call_id': call.id}
        )

        return Response({'message': 'Call accepted', 'call_id': call.id})
