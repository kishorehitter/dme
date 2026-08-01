"""
Views for chat app - REST API for conversations and messages.
"""
from rest_framework import status, generics, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Q, Max
from django.contrib.auth import get_user_model
from django.utils import timezone

from .models import (
    Conversation, ConversationParticipant, Message, MessageReaction,
    Status, StatusView, StatusPrivacy, FriendRequest, MessageRequest,
    check_message_allowed,
)
from .serializers import (
    ConversationSerializer,
    ConversationListSerializer,
    ConversationCreateSerializer,
    MessageSerializer,
    MessageReactionSerializer,
    UserMinimalSerializer,
    StatusPrivacySerializer,
    FriendRequestSerializer,
    MessageRequestSerializer,
)


class HealthCheckView(APIView):
    """Simple ping endpoint for keep-alive."""
    permission_classes = []  # Allow anyone to ping

    def get(self, request):
        return Response({'status': 'ok'}, status=status.HTTP_200_OK)

class ContactsListView(APIView):
    """Retrieve all users the current user has interacted with."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        
        # 1. Users from conversations
        conv_user_ids = ConversationParticipant.objects.filter(
            conversation__participants__user=user
        ).exclude(user=user).values_list('user_id', flat=True)
        
        # 2. Users whose profiles were viewed
        from accounts.models import ProfileInteraction
        viewed_user_ids = ProfileInteraction.objects.filter(
            viewer=user
        ).values_list('profile_owner_id', flat=True)
        
        all_contact_ids = set(conv_user_ids) | set(viewed_user_ids)
        
        # Fetch actual User objects
        contacts = get_user_model().objects.filter(id__in=all_contact_ids)
        
        serializer = UserMinimalSerializer(contacts, many=True, context={'request': request})
        return Response(serializer.data)

class StatusPrivacyView(APIView):
    """Fetch or update global default status privacy settings."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        privacy, created = StatusPrivacy.objects.get_or_create(user=request.user)
        # Return a list of IDs for restricted_to
        return Response({
            'restricted_to': list(privacy.restricted_to.values_list('id', flat=True))
        })

    def post(self, request):
        privacy, created = StatusPrivacy.objects.get_or_create(user=request.user)

        # Handle the case where restricted_to is a JSON string or a list
        restricted_to = request.data.get('restricted_to', [])
        if isinstance(restricted_to, str):
            import json
            try:
                restricted_to = json.loads(restricted_to)
            except:
                restricted_to = []

        if not isinstance(restricted_to, list):
            restricted_to = []

        privacy.restricted_to.set(restricted_to)
        return Response({'status': 'success'})


from rest_framework.exceptions import PermissionDenied
 
from .models import Status, StatusView
from .serializers import StatusViewSerializer


class IsConversationParticipant(permissions.BasePermission):
    """Only allow participants to access conversation."""
    
    def has_object_permission(self, request, view, obj):
        return obj.participants.filter(user=request.user).exists()


class ConversationViewSet(viewsets.ModelViewSet):
    """
    ViewSet for conversations.
    - List all conversations for current user
    - Create new conversation
    - Get/update/delete specific conversation
    """
    serializer_class = ConversationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Conversation.objects.filter(
            participants__user=self.request.user
        )

        # Exclude conversations where a MessageRequest exists and is either:
        # 1. 'pending' and the current user is the receiver (i.e. user has not accepted it yet)
        # 2. 'rejected' (i.e. request has been declined)
        from django.db.models import Exists, OuterRef
        pending_or_rejected_requests = MessageRequest.objects.filter(
            conversation=OuterRef('pk')
        ).filter(
            Q(status='rejected') |
            Q(status='pending', receiver=self.request.user)
        )

        qs = qs.exclude(Exists(pending_or_rejected_requests))

        return qs.prefetch_related('participants__user', 'messages').distinct().order_by('-updated_at')


    def get_serializer_class(self):
        if self.action == 'list':
            return ConversationListSerializer
        elif self.action == 'create':
            return ConversationCreateSerializer
        return ConversationSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    @action(detail=False, methods=['post'])
    def delete_all(self, request):
        """Delete all conversations for the current user."""
        self.get_queryset().delete()
        return Response({'message': 'All conversations deleted'}, status=status.HTTP_200_OK)

    def list(self, request, *args, **kwargs):
        """
        Override list to mark messages as delivered when user fetches chat list.
        This handles the case when User B sees message preview in chat list.
        """
        response = super().list(request, *args, **kwargs)

        # Mark messages as delivered when user fetches chat list
        from .models import Message
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        from django.utils import timezone

        conversations = self.get_queryset()
        conversation_ids = [c.id for c in conversations]

        # Get all undelivered messages from OTHER users in these conversations
        undelivered_message_ids = list(
            Message.objects.filter(
                conversation_id__in=conversation_ids,
                is_deleted=False
            ).exclude(
                sender=request.user
            ).filter(
                delivered_at__isnull=True
            ).values_list('id', flat=True)
        )
        
        if undelivered_message_ids:
            print(f"   📥 Chat list: Marking {len(undelivered_message_ids)} messages as delivered for user {request.user.id}")
            
            Message.objects.filter(
                id__in=undelivered_message_ids
            ).update(delivered_at=timezone.now())
            
            # Group messages by conversation for WebSocket notifications
            messages_by_conv = {}
            for msg_id in undelivered_message_ids:
                msg = Message.objects.get(id=msg_id)
                conv_id = msg.conversation_id
                if conv_id not in messages_by_conv:
                    messages_by_conv[conv_id] = []
                messages_by_conv[conv_id].append(msg_id)
            
            # Send delivered events to senders
            channel_layer = get_channel_layer()
            for conv_id, msg_ids in messages_by_conv.items():
                room_group_name = f'chat_{conv_id}'
                async_to_sync(channel_layer.group_send)(
                    room_group_name,
                    {
                        'type': 'delivery_message',
                        'message_ids': msg_ids,
                        'user_id': request.user.id
                    }
                )
            
            print(f"   ✅ Chat list: Marked {len(undelivered_message_ids)} messages as delivered")
        
        return response

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def partial_update(self, request, *args, **kwargs):
        """Allow admins to update group name, description, and profile picture."""
        instance = self.get_object()
        
        # Check if user is admin
        participant = ConversationParticipant.objects.filter(
            conversation=instance,
            user=request.user
        ).first()
        
        if not participant or (instance.is_group and not participant.is_admin):
            return Response(
                {'error': 'Only group admins can update group details'},
                status=status.HTTP_403_FORBIDDEN
            )
            
        return super().partial_update(request, *args, **kwargs)


import cloudinary.uploader
import re
from rest_framework import status, generics, permissions, viewsets
# ...
class ConversationUpdateProfileView(APIView):
    """Update group profile picture (admins only)."""
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, pk):
        try:
            conversation = Conversation.objects.get(pk=pk)
            if not conversation.is_group:
                return Response({'error': 'Only groups have profile pictures'}, status=status.HTTP_400_BAD_REQUEST)
            
            # Check if user is admin
            participant = ConversationParticipant.objects.filter(
                conversation=conversation,
                user=request.user
            ).first()
            if not participant or not participant.is_admin:
                return Response({'error': 'Only group admins can update profile picture'}, status=status.HTTP_403_FORBIDDEN)
            
            # Handle removal if profile_picture is explicitly set to null/empty in JSON body
            # or simply not in request.FILES
            if 'profile_picture' in request.data and request.data['profile_picture'] is None:
                if conversation.profile_picture:
                    try:
                        path = conversation.profile_picture.name
                        clean_path = re.sub(r'^v\d+/', '', path)
                        public_id = clean_path.rsplit('.', 1)[0]
                        cloudinary.uploader.destroy(public_id, invalidate=True)
                    except Exception as e:
                        print(f"DEBUG: Failed to delete group media from Cloudinary: {e}")
                conversation.profile_picture = None
                conversation.save()
                return Response({'message': 'Profile picture removed'})

            if 'profile_picture' in request.FILES:
                if conversation.profile_picture:
                    try:
                        path = conversation.profile_picture.name
                        clean_path = re.sub(r'^v\d+/', '', path)
                        public_id = clean_path.rsplit('.', 1)[0]
                        cloudinary.uploader.destroy(public_id, invalidate=True)
                    except Exception as e:
                        print(f"DEBUG: Failed to delete old group media from Cloudinary: {e}")

                conversation.profile_picture = request.FILES['profile_picture']
                conversation.save()
                return Response({'message': 'Profile picture updated', 'url': request.build_absolute_uri(conversation.profile_picture.url)})
            return Response({'error': 'No image provided'}, status=status.HTTP_400_BAD_REQUEST)
        except Conversation.DoesNotExist:
            return Response({'error': 'Conversation not found'}, status=status.HTTP_404_NOT_FOUND)


class ConversationDetailView(APIView):
    """Get details of a specific conversation."""
    permission_classes = [permissions.IsAuthenticated, IsConversationParticipant]
    
    def get(self, request, pk):
        try:
            conversation = Conversation.objects.get(pk=pk, participants__user=request.user)
            serializer = ConversationSerializer(conversation, context={'request': request})
            return Response(serializer.data)
        except Conversation.DoesNotExist:
            return Response({'error': 'Conversation not found'}, status=status.HTTP_404_NOT_FOUND)

class StatusViewersListView(APIView):
    """Fetch list of viewers for a specific status (owner only)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, status_id):
        try:
            status = Status.objects.get(pk=status_id)
            if status.user != request.user:
                return Response({'error': 'Not authorized'}, status=status.HTTP_403_FORBIDDEN)
            
            viewers = StatusView.objects.filter(status=status).select_related('viewer')
            serializer = StatusViewSerializer(viewers, many=True, context={'request': request})
            return Response(serializer.data)
        except Status.DoesNotExist:
            return Response({'error': 'Status not found'}, status=status.HTTP_404_NOT_FOUND)


class MessageViewSet(viewsets.ModelViewSet):
    """
    ViewSet for messages within a conversation.
    Handles both JSON and multipart/form-data (for file uploads).
    Supports pagination for large chat histories.
    """
    serializer_class = MessageSerializer
    permission_classes = [permissions.IsAuthenticated]
    # Paginate messages: 50 per page for better performance
    pagination_class = None  # We'll handle pagination manually for reverse loading

    def get_queryset(self):
        conversation_id = self.kwargs.get('conversation_id')
        # First verify user has access to this conversation
        user_has_access = Conversation.objects.filter(
            id=conversation_id,
            participants__user=self.request.user
        ).exists()

        if not user_has_access:
            return Message.objects.none()

        # Return all non-deleted messages that haven't been cleared by current user
        return Message.objects.filter(
            conversation_id=conversation_id,
            is_deleted=False
        ).exclude(
            cleared_by=self.request.user  # Exclude messages cleared by current user
        ).select_related('sender').order_by('created_at')

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    def list(self, request, *args, **kwargs):
        """
        Override list to:
        1. Mark messages as delivered when receiver fetches them (for offline users)
        2. Support pagination with 'limit' and 'before_id' for loading older messages
        
        Returns most recent messages first (reverse chronological order)
        ALWAYS returns only 'limit' messages (default 50) for fast loading
        """
        conversation_id = self.kwargs.get('conversation_id')
        
        # Get pagination params
        limit = int(request.query_params.get('limit', 50))  # Default 50 messages
        before_id = request.query_params.get('before_id')  # Load messages before this ID
        
        print(f"   📨 GET Messages: conversation={conversation_id}, limit={limit}, before_id={before_id}")
        
        # FIRST: Get unread messages from OTHER users BEFORE returning the response
        from .models import Message
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        from django.utils import timezone

        # Get all message IDs from OTHER users that don't have delivered_at set yet
        undelivered_queryset = Message.objects.filter(
            conversation_id=conversation_id,
            is_deleted=False
        ).exclude(
            sender=request.user
        ).filter(
            delivered_at__isnull=True
        )
        
        # If loading older messages (pagination), only mark those as delivered
        if before_id:
            undelivered_queryset = undelivered_queryset.filter(id__lt=int(before_id))
        
        undelivered_message_ids = list(undelivered_queryset.values_list('id', flat=True))

        # Build the queryset for messages
        queryset = self.filter_queryset(self.get_queryset())
        
        # Apply reverse pagination (load older messages)
        if before_id:
            queryset = queryset.filter(id__lt=int(before_id))
        
        # Get the most recent messages by ordering by -id (newest first), taking limit, then reversing
        # We use -id instead of -created_at for better performance (id is indexed)
        messages_list = list(queryset.order_by('-id')[:limit])
        messages_list.reverse()  # Now in chronological order (oldest to newest)
        
        print(f"   ✅ Returning {len(messages_list)} messages (requested limit={limit})")
        if messages_list:
            print(f"   📍 Message range: {messages_list[0].id} to {messages_list[-1].id}")
        
        serializer = self.get_serializer(messages_list, many=True)
        response = Response(serializer.data)

        # Mark messages as delivered
        if undelivered_message_ids:
            print(f"   📥 User {request.user.id} fetching messages, marking {len(undelivered_message_ids)} as delivered")
            
            # Mark as delivered
            Message.objects.filter(
                id__in=undelivered_message_ids
            ).update(delivered_at=timezone.now())

            # Send delivered event to senders via WebSocket
            channel_layer = get_channel_layer()
            room_group_name = f'chat_{conversation_id}'

            async_to_sync(channel_layer.group_send)(
                room_group_name,
                {
                    'type': 'delivery_message',
                    'message_ids': undelivered_message_ids,
                    'user_id': request.user.id
                }
            )
            
            print(f"   ✅ Marked {len(undelivered_message_ids)} messages as delivered and notified senders")

        return response

    def create(self, request, *args, **kwargs):
        """
        Override create to handle multipart/form-data for file uploads.
        Also enforces MessageRequest gating for non-friends.
        """
        conversation_id = self.kwargs.get('conversation_id')

        # Verify conversation exists and user is a participant
        try:
            conversation = Conversation.objects.get(pk=conversation_id)
        except Conversation.DoesNotExist:
            return Response(
                {'error': 'Conversation not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        if not conversation.participants.filter(user=request.user).exists():
            return Response(
                {'error': 'You are not a participant of this conversation'},
                status=status.HTTP_403_FORBIDDEN
            )

        # ── Message permission gate ────────────────────────────────────────────
        is_allowed, is_first, error_msg = check_message_allowed(conversation, request.user)
        if not is_allowed:
            return Response({'error': error_msg}, status=status.HTTP_403_FORBIDDEN)

        # Prepare data for serializer
        data = request.data.copy()
        data['sender'] = request.user.id
        data['conversation'] = conversation_id

        # Handle media file upload
        if request.FILES.get('media_file'):
            data['media_file'] = request.FILES.get('media_file')

        # Handle reply_to
        reply_to_id = request.data.get('reply_to')
        if reply_to_id:
            try:
                reply_message = Message.objects.get(id=reply_to_id)
                data['reply_to'] = reply_message.id
            except Message.DoesNotExist:
                pass

        # Set default content for media messages if content is empty
        if not data.get('content') and request.FILES.get('media_file'):
            message_type = data.get('message_type', 'text')
            content_map = {
                'audio': '',
                'image': '',
                'document': '',
                'video': '',
            }
            data['content'] = content_map.get(message_type, 'Media')

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        message = self.perform_create(serializer)

        # ── Auto-create MessageRequest on first message to a non-friend ────────
        if is_first:
            other_participant = conversation.participants.exclude(user=request.user).first()
            if other_participant:
                msg_req, created = MessageRequest.objects.get_or_create(
                    conversation=conversation,
                    defaults={
                        'sender': request.user,
                        'receiver': other_participant.user,
                        'status': 'pending',
                    }
                )
                try:
                    from channels.layers import get_channel_layer
                    from asgiref.sync import async_to_sync
                    from .serializers import MessageRequestSerializer
                    
                    channel_layer = get_channel_layer()
                    if channel_layer:
                        req_data = MessageRequestSerializer(msg_req, context={'request': request}).data
                        # Send to receiver's update channel
                        async_to_sync(channel_layer.group_send)(
                            f'user_updates_{other_participant.user_id}',
                            {
                                'type': 'message_request_created',
                                'data': req_data
                            }
                        )
                        # Send to chat room group
                        async_to_sync(channel_layer.group_send)(
                            f'chat_{conversation_id}',
                            {
                                'type': 'message_request_created',
                                'data': req_data
                            }
                        )
                except Exception as ws_err:
                    print(f"Warning: WebSocket broadcast for message request creation failed: {ws_err}")


        # WhatsApp-style: Broadcast message via WebSocket and trigger FCM
        self.broadcast_and_notify(message)

        # Update conversation updated_at timestamp
        conversation.save()

        headers = self.get_success_headers(serializer.data)
        response_data = serializer.data
        if is_first:
            response_data = dict(response_data)
            response_data['is_message_request'] = True
        return Response(response_data, status=status.HTTP_201_CREATED, headers=headers)


    def perform_create(self, serializer):
        conversation_id = self.kwargs.get('conversation_id')
        conversation = Conversation.objects.get(pk=conversation_id)

        # Get duration from request data (for audio messages)
        audio_duration = self.request.data.get('duration')

        message = serializer.save(
            conversation=conversation,
            sender=self.request.user,
            audio_duration=audio_duration if audio_duration else None
        )

        return message

    def broadcast_and_notify(self, message):
        """Broadcast message to WebSocket and send FCM notification."""
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            from .serializers import MessageSerializer
            from notifications.fcm_service import FCMService

            # 1. Prepare message data for WebSocket
            serializer = MessageSerializer(message, context={'request': self.request})
            message_data = serializer.data

            # 2. Broadcast to WebSocket room (may fail if channel layer not available)
            try:
                channel_layer = get_channel_layer()
                if channel_layer:
                    room_group_name = f'chat_{message.conversation_id}'
                    async_to_sync(channel_layer.group_send)(
                        room_group_name,
                        {
                            'type': 'chat_message',
                            'message': message_data
                        }
                    )
            except Exception as ws_error:
                # WebSocket broadcast failure is non-critical - message is still saved
                print(f"Warning: WebSocket broadcast failed (non-critical): {ws_error}")

            # 3. Trigger FCM for other participants (critical - always execute)
            participants = message.conversation.participants.exclude(user=message.sender)

            sender_name = message.sender.display_name or message.sender.email

            for participant in participants:
                # Note: We don't check if online here, FCMService handles sending.
                # In a real production app, we might check user_active_conversations
                # but since this is from a view, we'll just send it.
                FCMService.send_chat_notification(
                    recipient=participant.user,
                    sender_name=sender_name,
                    message_content=message.content,
                    conversation_id=message.conversation_id,
                    message_id=message.id,
                    message_type=message.message_type,
                    sender_avatar=message.sender.clean_profile_picture_url
                )
        except Exception as e:
            # Log the error but don't re-raise - message is already saved
            print(f"Error in broadcast_and_notify: {e}")
            import traceback
            traceback.print_exc()

    def destroy(self, request, *args, **kwargs):
        """Delete all messages in a conversation."""
        conversation_id = self.kwargs.get('conversation_id')
        
        # Verify user has access to this conversation
        user_has_access = Conversation.objects.filter(
            id=conversation_id,
            participants__user=request.user
        ).exists()

        if not user_has_access:
            return Response(
                {'error': 'You do not have access to this conversation'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Delete all messages in the conversation
        deleted_count, _ = Message.objects.filter(
            conversation_id=conversation_id
        ).delete()
        
        return Response(
            {'message': f'Cleared {deleted_count} messages'},
            status=status.HTTP_200_OK
        )


class ClearChatView(APIView):
    """
    Clear all messages in a conversation for the current user only.
    This is a WhatsApp-style "Clear chat" - messages are hidden only for the requesting user,
    not deleted from the database or for other participants.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, conversation_id):
        try:
            # Verify user has access to this conversation
            conversation = Conversation.objects.get(
                pk=conversation_id,
                participants__user=request.user
            )

            # Get all messages in this conversation
            messages = Message.objects.filter(conversation_id=conversation_id)
            
            # Add current user to cleared_by for each message
            for message in messages:
                message.cleared_by.add(request.user)
            
            return Response(
                {'message': f'Cleared {messages.count()} messages from your view'},
                status=status.HTTP_200_OK
            )
        except Conversation.DoesNotExist:
            return Response(
                {'error': 'Conversation not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )


class MarkMessagesReadView(APIView):
    """Mark all messages in a conversation as read."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, conversation_id):
        try:
            conversation = Conversation.objects.get(
                pk=conversation_id,
                participants__user=request.user
            )

            # Get user's participant record
            participant = ConversationParticipant.objects.get(
                conversation=conversation,
                user=request.user
            )

            # Get last message
            last_message = conversation.messages.filter(is_deleted=False).order_by('-created_at').first()

            if last_message:
                # Update last read message
                participant.last_read_message = last_message
                participant.save()

                # BUG 1 FIX: Only mark messages as read where sender != current user
                # This prevents sender from marking their own messages as read
                messages_marked = list(
                    conversation.messages.filter(
                        is_read=False,
                        created_at__lte=last_message.created_at
                    ).exclude(
                        sender=request.user  # Exclude own messages
                    )
                )
                
                # Update is_read status
                for msg in messages_marked:
                    msg.is_read = True
                    msg.save()

                # BUG 2 FIX: Send read_receipt via WebSocket to sender
                if messages_marked:
                    from channels.layers import get_channel_layer
                    from asgiref.sync import async_to_sync
                    
                    channel_layer = get_channel_layer()
                    room_group_name = f'chat_{conversation_id}'
                    
                    message_ids = [msg.id for msg in messages_marked]
                    
                    # Send read receipt to all participants (sender will receive it)
                    async_to_sync(channel_layer.group_send)(
                        room_group_name,
                        {
                            'type': 'read_receipt',
                            'message_ids': message_ids,
                            'user_id': request.user.id
                        }
                    )

            return Response({'message': 'Messages marked as read'})
        except (Conversation.DoesNotExist, ConversationParticipant.DoesNotExist):
            return Response({'error': 'Conversation not found'}, status=status.HTTP_404_NOT_FOUND)


class AddParticipantView(APIView):
    """Add participants to a group conversation."""
    permission_classes = [permissions.IsAuthenticated]
    
    def post(self, request, conversation_id):
        from calls.models import GroupCall
        from notifications.fcm_service import FCMService
        
        try:
            conversation = Conversation.objects.get(pk=conversation_id)
            User = get_user_model()
            user_ids = request.data.get('user_ids', [])
            
            if not isinstance(user_ids, list):
                return Response({'error': 'user_ids must be a list'}, status=status.HTTP_400_BAD_REQUEST)

            # Case A: Conversation is already a group
            if conversation.is_group:
                # Check if requesting user is admin
                try:
                    requesting_participant = ConversationParticipant.objects.get(
                        conversation=conversation, 
                        user=request.user
                    )
                    if not requesting_participant.is_admin:
                        return Response({'error': 'Only admins can add participants to this group'},
                                      status=status.HTTP_403_FORBIDDEN)
                except ConversationParticipant.DoesNotExist:
                    return Response({'error': 'You are not a participant of this group'},
                                  status=status.HTTP_403_FORBIDDEN)

                added_users = []
                for user_id in user_ids:
                    if not conversation.participants.filter(user_id=user_id).exists():
                        p = ConversationParticipant.objects.create(
                            conversation=conversation,
                            user_id=user_id
                        )
                        added_users.append(p.user)
                
                # If there's an active group call, notify new participants
                active_call = GroupCall.objects.filter(conversation=conversation, is_active=True).first()
                if active_call and added_users:
                    initiator_name = request.user.display_name or request.user.email
                    for user in added_users:
                        try:
                            FCMService.send_group_call_notification(
                                recipient=user,
                                initiator_name=initiator_name,
                                initiator_id=request.user.id,
                                call_id=active_call.id,
                                room_id=active_call.room_id,
                                conversation=conversation,
                                call_type=active_call.call_type
                            )
                        except Exception as e:
                            print(f"Error notifying {user.email} of active call: {e}")

                return Response({
                    'message': f'Added {len(added_users)} participants to the group',
                    'added': [u.id for u in added_users],
                    'conversation_id': conversation.id,
                    'is_new_group': False
                })

            # Case B: Conversation is 1-on-1. Create a NEW group.
            else:
                from calls.models import Call, GroupCall, GroupCallParticipant as GCP
                import uuid
                
                # Get current participants of the 1-on-1
                current_participants = list(conversation.participants.all())
                current_participant_ids = [p.user_id for p in current_participants]
                
                # Combine with new user_ids and deduplicate
                all_participant_ids = list(set(current_participant_ids + user_ids))
                
                # Create a NEW group conversation
                new_group = Conversation.objects.create(
                    name="Group Chat",
                    is_group=True,
                    created_by=request.user
                )
                
                # Add all participants to the new group
                for uid in all_participant_ids:
                    ConversationParticipant.objects.create(
                        conversation=new_group,
                        user_id=uid,
                        is_admin=(uid == request.user.id) # Creator is admin
                    )
                
                # SPECIAL FEATURE: If this was triggered during an active 1-on-1 call,
                # we should automatically initiate a group call in the NEW group.
                active_1on1 = Call.objects.filter(
                    (Q(caller=request.user, receiver__id__in=current_participant_ids) |
                     Q(receiver=request.user, caller__id__in=current_participant_ids)),
                    status__in=['ringing', 'accepted', 'connected']
                ).order_by('-started_at').first()
                
                if active_1on1:
                    print(f"   📞 Active 1-on-1 call {active_1on1.id} found. Upgrading to group call in new conversation {new_group.id}")
                    
                    # Create a new group call record
                    room_name = f"group_{new_group.id}_{int(timezone.now().timestamp())}_{uuid.uuid4().hex[:6]}"
                    group_call = GroupCall.objects.create(
                        conversation=new_group,
                        initiator=request.user,
                        call_type=active_1on1.call_type,
                        room_id=room_name,
                        is_active=True,
                    )
                    
                    # Add initiator to the new group call
                    GCP.objects.create(group_call=group_call, user=request.user)
                    
                    # Notify ALL participants of the new group call so they can transition/join
                    # This effectively "rings" the new person and invites the existing partner to the new room
                    initiator_name = request.user.display_name or request.user.email
                    User = get_user_model()
                    for p_id in all_participant_ids:
                        if p_id == request.user.id: continue
                        try:
                            target_user = User.objects.get(id=p_id)
                            FCMService.send_group_call_notification(
                                recipient=target_user,
                                initiator_name=initiator_name,
                                initiator_id=request.user.id,
                                call_id=group_call.id,
                                room_id=group_call.room_id,
                                conversation=new_group,
                                call_type=group_call.call_type
                            )
                        except Exception as e:
                            print(f"   ❌ Error sending group upgrade notification: {e}")

                return Response({
                    'message': 'Created new group and sent call invitations',
                    'added': user_ids,
                    'conversation_id': new_group.id,
                    'is_new_group': True
                })
            
        except Conversation.DoesNotExist:
            return Response({'error': 'Conversation not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class RemoveParticipantView(APIView):
    """Remove a participant from a group conversation."""
    permission_classes = [permissions.IsAuthenticated]
    def post(self, request, conversation_id):
        try:
            conversation = Conversation.objects.get(pk=conversation_id)
            if not conversation.is_group:
                return Response({'error': 'Cannot remove participants from one-on-one conversation'},
                              status=status.HTTP_400_BAD_REQUEST)
            # Check if user is admin
            participant = ConversationParticipant.objects.get(
                conversation=conversation,
                user=request.user
            )
            if not participant.is_admin:
                return Response({'error': 'Only admins can remove participants'},
                              status=status.HTTP_403_FORBIDDEN)
            user_id = request.data.get('user_id')
            if not user_id:
                return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
            ConversationParticipant.objects.filter(
                conversation=conversation,
                user_id=user_id
            ).delete()
            return Response({'message': 'Participant removed successfully'})
        except Conversation.DoesNotExist:
            return Response({'error': 'Conversation not found'}, status=status.HTTP_404_NOT_FOUND)
        except ConversationParticipant.DoesNotExist:
            return Response({'error': 'Not authorized'}, status=status.HTTP_403_FORBIDDEN)
class SearchUsersView(APIView):
    """Search users to start conversation with by partial username, display name or email match."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        contacts_only = request.query_params.get('contacts_only', 'false').lower() == 'true'
        User = get_user_model()
        from .models import ConversationParticipant

        # Get IDs of users with whom the current user has a direct conversation
        direct_conv_user_ids = ConversationParticipant.objects.filter(
            conversation__is_group=False,
            conversation__participants__user=request.user
        ).exclude(
            user=request.user
        ).values_list('user_id', flat=True).distinct()

        if not query:
            # Fetch those users
            users = User.objects.filter(id__in=direct_conv_user_ids)

            # If fewer than 20, and NOT contacts_only, fetch more users until 20
            if not contacts_only and users.count() < 20:
                more_users = User.objects.exclude(
                    id=request.user.id
                ).exclude(
                    id__in=direct_conv_user_ids
                )[:20 - users.count()]
                users = (users | more_users).distinct()
        else:
            # 1. Always check for strict username match (case-insensitive)
            strict_username_match = User.objects.filter(username__iexact=query).exclude(id=request.user.id)

            # 2. Allow partial matching on display_name/email/username if query is >= 3 characters or contacts_only is True
            if len(query) >= 3 or contacts_only:
                partial_matches = User.objects.filter(
                    Q(display_name__icontains=query) |
                    Q(email__icontains=query) |
                    Q(username__icontains=query)
                ).exclude(id=request.user.id)

                # Combine strict username matches with partial matches
                users = (strict_username_match | partial_matches).distinct()
            else:
                # For queries < 3 chars, ONLY allow strict username match
                users = strict_username_match

            # If contacts_only, filter the results to only include users they have had conversations with
            if contacts_only:
                users = users.filter(id__in=direct_conv_user_ids)

        serializer = UserMinimalSerializer(users[:20], many=True, context={'request': request})
        return Response(serializer.data)


class GetOrCreateDirectConversationView(APIView):
    """Get existing or create new direct conversation with a user."""
    permission_classes = [permissions.IsAuthenticated]
    
    def get(self, request, user_id):
        User = get_user_model()
        try:
            other_user = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
        # Find existing conversation
        existing = Conversation.objects.filter(
            is_group=False,
            participants__user=request.user
        ).filter(
            participants__user=other_user
        ).first()
        
        if existing:
            serializer = ConversationSerializer(existing, context={'request': request})
            return Response(serializer.data)
        
        # Create new conversation
        conversation = Conversation.objects.create(is_group=False, created_by=request.user)
        ConversationParticipant.objects.create(conversation=conversation, user=request.user)
        ConversationParticipant.objects.create(conversation=conversation, user=other_user)
        
        serializer = ConversationSerializer(conversation, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class MessageReactionView(APIView):
    """Add or update reaction to a message."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, message_id):
        try:
            message = Message.objects.get(pk=message_id)
            emoji = request.data.get('emoji')

            if not emoji:
                return Response({'error': 'Emoji is required'}, status=status.HTTP_400_BAD_REQUEST)

            # Delete any existing reaction from this user for this message
            MessageReaction.objects.filter(message=message, user=request.user).delete()

            # Create new reaction
            reaction = MessageReaction.objects.create(
                message=message,
                user=request.user,
                emoji=emoji
            )

            # Broadcast reaction to all users in the conversation via WebSocket
            try:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                
                # Get all reactions for this message
                all_reactions = MessageReaction.objects.filter(message=message)
                reactions_dict = {str(r.user.id): r.emoji for r in all_reactions}
                
                # Broadcast to WebSocket room
                channel_layer = get_channel_layer()
                if channel_layer:
                    room_group_name = f'chat_{message.conversation_id}'
                    async_to_sync(channel_layer.group_send)(
                        room_group_name,
                        {
                            'type': 'broadcast_reaction',
                            'message_id': message.id,
                            'reactions': reactions_dict
                        }
                    )
            except Exception as ws_error:
                # WebSocket broadcast failure is non-critical - reaction is still saved
                print(f"Warning: Reaction broadcast failed (non-critical): {ws_error}")

            serializer = MessageReactionSerializer(reaction)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)


EDIT_WINDOW_MINUTES = 15          # How long a message can be edited after sending
UNSEND_WINDOW_HOURS = 24          # How long a sender can unsend (delete for everyone)


class MessageEditView(APIView):
    """Edit a message (sender only, within 15 minutes of sending)."""
    permission_classes = [permissions.IsAuthenticated]

    def put(self, request, message_id):
        try:
            message = Message.objects.get(pk=message_id)

            # Only sender can edit
            if message.sender != request.user:
                return Response(
                    {'error': 'Only sender can edit message'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # Enforce 15-minute edit window
            from datetime import timedelta
            age = timezone.now() - message.created_at
            if age > timedelta(minutes=EDIT_WINDOW_MINUTES):
                return Response(
                    {'error': 'This message can no longer be edited. Messages can only be edited within 15 minutes of being sent.'},
                    status=status.HTTP_403_FORBIDDEN
                )

            new_content = request.data.get('content')
            if not new_content:
                return Response(
                    {'error': 'Content is required'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            message.content = new_content
            message.edited_at = timezone.now()
            message.save()

            serializer = MessageSerializer(message)

            # Broadcast edit over WebSocket
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            
            channel_layer = get_channel_layer()
            room_group_name = f'chat_{message.conversation_id}'
            
            # 1. Update message list in active ChatRoom
            async_to_sync(channel_layer.group_send)(
                room_group_name,
                {
                    'type': 'message_edit',
                    'data': {
                        'message_id': message.id,
                        'conversation_id': message.conversation_id,
                        'content': message.content,
                        'edited_at': message.edited_at.isoformat() if message.edited_at else None
                    }
                }
            )
            
            # 2. Update chatlist previews (last message preview)
            participants = message.conversation.participants.values_list('user_id', flat=True)
            for p_id in participants:
                async_to_sync(channel_layer.group_send)(
                    f'user_updates_{p_id}',
                    {
                        'type': 'new_message_summary',
                        'data': serializer.data
                    }
                )

            # 3. Trigger FCM for message edit
            try:
                from notifications.fcm_service import FCMService
                fcm_recipients = message.conversation.participants.exclude(user=request.user)
                sender_name = request.user.display_name or request.user.email
                sender_avatar = request.user.clean_profile_picture_url if hasattr(request.user, 'clean_profile_picture_url') else None
                
                for participant in fcm_recipients:
                    FCMService.send_edit_notification(
                        recipient=participant.user,
                        sender_name=sender_name,
                        message_content=message.content,
                        conversation_id=message.conversation_id,
                        message_id=message.id,
                        sender_avatar=sender_avatar
                    )
            except Exception as fcm_err:
                print(f"Warning: Edit FCM send failed: {fcm_err}")

            return Response(serializer.data)
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)


import cloudinary.uploader
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from .models import Message

class MessageDeleteView(APIView):
    """Delete a message (soft delete for receiver, hard delete for sender)."""
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, message_id):
        try:
            message = Message.objects.get(pk=message_id)
            
            # Check if user is sender or receiver
            is_sender = message.sender == request.user
            is_receiver = message.conversation.participants.filter(user=request.user).exists()
            
            if not is_sender and not is_receiver:
                return Response(
                    {'error': 'You do not have permission to delete this message'},
                    status=status.HTTP_403_FORBIDDEN
                )
            
            if is_sender:
                # Enforce 24-hour unsend window for senders
                from datetime import timedelta
                age = timezone.now() - message.created_at
                if age > timedelta(hours=UNSEND_WINDOW_HOURS):
                    return Response(
                        {'error': 'This message can no longer be unsent. Messages can only be unsent within 24 hours of being sent.'},
                        status=status.HTTP_403_FORBIDDEN
                    )

                # If message has media, delete from Cloudinary
                if message.media_file:
                    try:
                        # Path: v1779254828/chat_media/1000087081.jpg
                        path = message.media_file.name

                        # 1. Remove the version prefix if present (e.g., 'v12345/')
                        import re
                        clean_path = re.sub(r'^v\d+/', '', path)

                        # 2. Remove extension
                        public_id = clean_path.rsplit('.', 1)[0]

                        print(f"DEBUG: Attempting to delete from Cloudinary. Original: {path}, Clean: {clean_path}, Public ID: {public_id}")
                        result = cloudinary.uploader.destroy(public_id, invalidate=True)
                        print(f"DEBUG: Cloudinary deletion result: {result}")
                    except Exception as e:
                        print(f"DEBUG: Failed to delete media from Cloudinary: {e}")

                # Sender can unsend (delete for everyone)
                message.is_deleted = True
                message.content = 'The message was removed'
                message.media_file = None  # Clear the reference
                message.save()

                serializer = MessageSerializer(message)

                # Broadcast delete over WebSocket
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                
                channel_layer = get_channel_layer()
                room_group_name = f'chat_{message.conversation_id}'
                
                # 1. Update message list in active ChatRoom
                async_to_sync(channel_layer.group_send)(
                    room_group_name,
                    {
                        'type': 'message_delete',
                        'data': {
                            'message_id': message.id,
                            'conversation_id': message.conversation_id,
                            'content': message.content
                        }
                    }
                )
                
                # 2. Update chatlist previews (last message preview)
                participants = message.conversation.participants.values_list('user_id', flat=True)
                for p_id in participants:
                    async_to_sync(channel_layer.group_send)(
                        f'user_updates_{p_id}',
                        {
                            'type': 'new_message_summary',
                            'data': serializer.data
                        }
                    )

                # 3. Trigger FCM for message delete
                try:
                    from notifications.fcm_service import FCMService
                    fcm_recipients = message.conversation.participants.exclude(user=request.user)
                    
                    for participant in fcm_recipients:
                        FCMService.send_delete_notification(
                            recipient=participant.user,
                            conversation_id=message.conversation_id,
                            message_id=message.id
                        )
                except Exception as fcm_err:
                    print(f"Warning: Delete FCM send failed: {fcm_err}")

                return Response({'message': 'Message unsent for everyone'})
            else:
                # Receiver deletes for themselves only (soft delete)
                message.is_deleted = True
                message.save()
                return Response({'message': 'Message deleted for you'})
                
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)


class DeleteConversationView(APIView):
    """
    Delete/remove conversation for the current user only.
    This removes the user from conversation participants, so it disappears from their chat list.
    The conversation and messages remain for other participants.
    """
    permission_classes = [permissions.IsAuthenticated]
    
    def delete(self, request, conversation_id):
        try:
            # Get conversation and verify user is a participant
            conversation = Conversation.objects.get(
                pk=conversation_id,
                participants__user=request.user
            )
            
            # For one-on-one chats, clear all messages and remove from participant list
            if not conversation.is_group:
                # Clear all messages for this user by adding them to cleared_by
                messages = Message.objects.filter(conversation_id=conversation_id)
                for message in messages:
                    message.cleared_by.add(request.user)
                
                # Remove user from participants so conversation disappears from their list
                ConversationParticipant.objects.filter(
                    conversation=conversation,
                    user=request.user
                ).delete()
                
                return Response({
                    'message': 'Chat deleted and removed from your list',
                    'cleared_count': messages.count()
                })
            else:
                # For group chats, just remove the user from participants
                ConversationParticipant.objects.filter(
                    conversation=conversation,
                    user=request.user
                ).delete()
                
                return Response({
                    'message': 'You have left the group conversation'
                })
                
        except Conversation.DoesNotExist:
            return Response(
                {'error': 'Conversation not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )


class ConversationMediaView(APIView):
    """Fetch all media messages in a conversation with strict type filtering."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, conversation_id):
        # Verify user has access to this conversation
        user_has_access = Conversation.objects.filter(
            id=conversation_id,
            participants__user=request.user
        ).exists()

        if not user_has_access:
            return Response({'error': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)

        msg_type = request.query_params.get('type')
        
        # Define strict extension filters
        image_exts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic']
        video_exts = ['.mp4', '.mov', '.avi', '.mkv']
        audio_exts = ['.mp3', '.m4a', '.wav', '.aac', '.ogg']
        # Documents are anything else that isn't one of the above if type is 'document'

        queryset = Message.objects.filter(
            conversation_id=conversation_id,
            is_deleted=False
        ).exclude(
            cleared_by=request.user
        ).select_related('sender').order_by('-created_at')

        if msg_type == 'image':
            queryset = queryset.filter(
                Q(message_type='image') | 
                Q(media_file__icontains='.jpg') | Q(media_file__icontains='.png') |
                Q(media_file__icontains='.jpeg') | Q(media_file__icontains='.webp')
            ).filter(message_type__in=['image', 'text', 'document']) # Handle cases where images were sent as docs
        elif msg_type == 'video':
            queryset = queryset.filter(
                Q(message_type='video') |
                Q(media_file__icontains='.mp4') | Q(media_file__icontains='.mov')
            )
        elif msg_type == 'audio':
            queryset = queryset.filter(
                Q(message_type='audio') |
                Q(media_file__icontains='.mp3') | Q(media_file__icontains='.m4a') |
                Q(media_file__icontains='.wav')
            )
        elif msg_type == 'document':
            # Exclude images, videos, and audio from documents
            queryset = queryset.filter(message_type='document').exclude(
                Q(media_file__icontains='.jpg') | Q(media_file__icontains='.png') |
                Q(media_file__icontains='.jpeg') | Q(media_file__icontains='.webp') |
                Q(media_file__icontains='.mp4') | Q(media_file__icontains='.mov') |
                Q(media_file__icontains='.mp3') | Q(media_file__icontains='.m4a')
            )
        else:
            # Default fallback for old behavior
            media_types = ['image', 'video', 'audio', 'document']
            queryset = queryset.filter(message_type__in=media_types)

        # Optional: Filter by specific sender
        sender_id = request.query_params.get('sender_id')
        if sender_id:
            queryset = queryset.filter(sender_id=sender_id)

        serializer = MessageSerializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)


# ─── Friend Request Views ─────────────────────────────────────────────────────

class FriendRequestListView(APIView):
    """
    GET  /chat/friends/requests/         → list incoming + outgoing pending requests
    POST /chat/friends/requests/         → send a friend request to user_id
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        received = FriendRequest.objects.filter(
            receiver=request.user, status='pending'
        ).select_related('sender', 'receiver')
        sent = FriendRequest.objects.filter(
            sender=request.user, status='pending'
        ).select_related('sender', 'receiver')

        return Response({
            'received': FriendRequestSerializer(received, many=True, context={'request': request}).data,
            'sent': FriendRequestSerializer(sent, many=True, context={'request': request}).data,
        })

    def post(self, request):
        receiver_id = request.data.get('user_id')
        if not receiver_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            receiver = get_user_model().objects.get(id=receiver_id)
        except get_user_model().DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        if receiver == request.user:
            return Response(
                {'error': 'You cannot send a friend request to yourself'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check for existing request in either direction
        existing = FriendRequest.objects.filter(
            Q(sender=request.user, receiver=receiver) |
            Q(sender=receiver, receiver=request.user)
        ).first()

        if existing:
            if existing.status == 'accepted':
                return Response({'error': 'You are already friends'}, status=status.HTTP_400_BAD_REQUEST)
            if existing.status == 'pending':
                if existing.sender == request.user:
                    return Response({'error': 'Friend request already sent'}, status=status.HTTP_400_BAD_REQUEST)
                # The other person already sent us a request — auto-accept
                existing.status = 'accepted'
                existing.save()
                _notify_friend_request_accepted(existing)
                _auto_accept_message_request(existing.sender, existing.receiver)
                return Response(
                    FriendRequestSerializer(existing, context={'request': request}).data,
                    status=status.HTTP_200_OK,
                )
            if existing.status == 'rejected':
                # Allow re-sending after rejection
                existing.status = 'pending'
                existing.sender = request.user
                existing.receiver = receiver
                existing.save()
                _notify_friend_request_sent(existing)
                return Response(
                    FriendRequestSerializer(existing, context={'request': request}).data,
                    status=status.HTTP_201_CREATED,
                )

        fr = FriendRequest.objects.create(sender=request.user, receiver=receiver)
        _notify_friend_request_sent(fr)
        return Response(
            FriendRequestSerializer(fr, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class FriendRequestActionView(APIView):
    """
    POST   /chat/friends/requests/<int:request_id>/accept/  → accept incoming request
    POST   /chat/friends/requests/<int:request_id>/reject/  → reject incoming request
    DELETE /chat/friends/requests/<int:request_id>/         → cancel own sent request
    Note: request_id parameter can be either the actual FriendRequest ID or the target/source User ID.
    """
    permission_classes = [permissions.IsAuthenticated]

    def _get_incoming(self, request_id, user):
        return FriendRequest.objects.filter(
            Q(id=request_id) | Q(sender_id=request_id),
            receiver=user,
            status='pending'
        ).first()

    def post(self, request, request_id, action):
        if action == 'accept':
            fr = self._get_incoming(request_id, request.user)
            if not fr:
                return Response({'error': 'Friend request not found'}, status=status.HTTP_404_NOT_FOUND)
            fr.status = 'accepted'
            fr.save()
            _notify_friend_request_accepted(fr)
            # Auto-accept any pending MessageRequest between the two users so
            # the conversation immediately appears in All/Friends (not stuck in Pending).
            _auto_accept_message_request(fr.sender, fr.receiver)
            return Response(FriendRequestSerializer(fr, context={'request': request}).data)

        elif action == 'reject':
            fr = self._get_incoming(request_id, request.user)
            if not fr:
                return Response({'error': 'Friend request not found'}, status=status.HTTP_404_NOT_FOUND)
            fr.status = 'rejected'
            fr.save()
            return Response(FriendRequestSerializer(fr, context={'request': request}).data)

        return Response({'error': 'Invalid action'}, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, request_id, action=None):
        """Cancel a sent friend request (sender only)."""
        try:
            fr = FriendRequest.objects.filter(
                Q(id=request_id) | Q(receiver_id=request_id),
                sender=request.user,
                status='pending'
            ).first()
            if not fr:
                return Response({'error': 'Friend request not found'}, status=status.HTTP_404_NOT_FOUND)
            fr.delete()
            return Response({'message': 'Friend request cancelled'}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)



class FriendsListView(APIView):
    """
    GET    /chat/friends/                   → list all accepted friends
    DELETE /chat/friends/<int:user_id>/     → unfriend a user
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        frs = FriendRequest.objects.filter(
            Q(sender=request.user, status='accepted') |
            Q(receiver=request.user, status='accepted')
        ).select_related('sender', 'receiver')

        friends = []
        for fr in frs:
            friend_user = fr.receiver if fr.sender == request.user else fr.sender
            friends.append(friend_user)

        serializer = UserMinimalSerializer(friends, many=True, context={'request': request})
        return Response(serializer.data)

    def delete(self, request, user_id):
        """Unfriend a user — delete the accepted FriendRequest in either direction."""
        deleted, _ = FriendRequest.objects.filter(
            Q(sender=request.user, receiver_id=user_id, status='accepted') |
            Q(sender_id=user_id, receiver=request.user, status='accepted')
        ).delete()
        if deleted:
            return Response({'message': 'Unfriended successfully'})
        return Response({'error': 'Friendship not found'}, status=status.HTTP_404_NOT_FOUND)


# ─── Message Request Views ────────────────────────────────────────────────────

class MessageRequestListView(APIView):
    """
    GET /chat/message-requests/   → list pending incoming message requests
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        requests_qs = MessageRequest.objects.filter(
            receiver=request.user, status='pending'
        ).select_related('sender', 'receiver', 'conversation')

        serializer = MessageRequestSerializer(requests_qs, many=True, context={'request': request})
        return Response(serializer.data)


class MessageRequestActionView(APIView):
    """
    POST /chat/message-requests/<int:request_id>/accept/  → accept (open the conversation)
    POST /chat/message-requests/<int:request_id>/reject/  → decline (block further messages)
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, request_id, action):
        if action in ['accept', 'approve']:
            return MessageRequestApproveView().post(request, request_id)
        elif action in ['reject', 'decline']:
            return MessageRequestRejectView().post(request, request_id)
        return Response({'error': 'Invalid action'}, status=status.HTTP_400_BAD_REQUEST)


# ─── FCM Notification Helpers ─────────────────────────────────────────────────

def _notify_friend_request_sent(fr):
    """Push notification to the receiver when a friend request is sent."""
    try:
        from notifications.fcm_service import FCMService
        sender_name = fr.sender.display_name or fr.sender.username or 'Someone'
        FCMService.send_to_user(
            user=fr.receiver,
            notification={
                'title': 'New Friend Request',
                'body': f'{sender_name} sent you a friend request',
            },
            data={
                'type': 'friend_request',
                'action': 'sent',
                'request_id': str(fr.id),
                'sender_id': str(fr.sender_id),
                'sender_name': sender_name,
            },
        )
    except Exception as e:
        print(f'Warning: FCM friend_request_sent failed: {e}')


def _auto_accept_message_request(user_a, user_b):
    """
    When two users become friends, automatically accept any pending MessageRequest
    between them (in either direction) so the conversation is visible in All/Friends.
    Also broadcasts the status change over WebSocket.
    """
    try:
        msg_req = MessageRequest.objects.filter(
            Q(sender=user_a, receiver=user_b) | Q(sender=user_b, receiver=user_a),
            status='pending'
        ).select_related('sender', 'receiver', 'conversation').first()

        if not msg_req:
            return  # No pending message request — nothing to do.

        msg_req.status = 'accepted'
        msg_req.save()

        # Broadcast via WebSocket so frontends update in real-time.
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer:
                event_data = {
                    'conversation_id': msg_req.conversation_id,
                    'status': 'accepted',
                    'sender_id': msg_req.sender_id,
                    'receiver_id': msg_req.receiver_id,
                    'auto_accepted_by_friendship': True,
                }
                async_to_sync(channel_layer.group_send)(
                    f'chat_{msg_req.conversation_id}',
                    {'type': 'message_request_status', 'data': event_data}
                )
                for u_id in [msg_req.sender_id, msg_req.receiver_id]:
                    async_to_sync(channel_layer.group_send)(
                        f'user_updates_{u_id}',
                        {'type': 'message_request_status', 'data': event_data}
                    )
        except Exception as ws_err:
            print(f'Warning: WebSocket broadcast for auto-accepted message request failed: {ws_err}')
    except Exception as e:
        print(f'Warning: _auto_accept_message_request failed: {e}')


def _notify_friend_request_accepted(fr):
    """Push notification to the original sender when their request is accepted."""
    try:
        from notifications.fcm_service import FCMService
        acceptor_name = fr.receiver.display_name or fr.receiver.username or 'Someone'
        FCMService.send_to_user(
            user=fr.sender,
            notification={
                'title': 'Friend Request Accepted',
                'body': f'{acceptor_name} accepted your friend request',
            },
            data={
                'type': 'friend_request',
                'action': 'accepted',
                'request_id': str(fr.id),
                'acceptor_id': str(fr.receiver_id),
                'acceptor_name': acceptor_name,
            },
        )
    except Exception as e:
        print(f'Warning: FCM friend_request_accepted failed: {e}')


def _notify_message_request_accepted(msg_req):
    """Push notification to the message sender when their request is accepted."""
    try:
        from notifications.fcm_service import FCMService
        acceptor_name = msg_req.receiver.display_name or msg_req.receiver.username or 'Someone'
        FCMService.send_to_user(
            user=msg_req.sender,
            notification={
                'title': 'Message Request Accepted',
                'body': f'{acceptor_name} accepted your message request',
            },
            data={
                'type': 'message_request',
                'action': 'accepted',
                'request_id': str(msg_req.id),
                'conversation_id': str(msg_req.conversation_id),
                'acceptor_name': acceptor_name,
            },
        )
    except Exception as e:
        print(f'Warning: FCM message_request_accepted failed: {e}')


class FriendRequestListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        received = FriendRequest.objects.filter(
            receiver=request.user, status='pending'
        ).select_related('sender', 'receiver')
        sent = FriendRequest.objects.filter(
            sender=request.user, status='pending'
        ).select_related('sender', 'receiver')

        return Response({
            'received': FriendRequestSerializer(received, many=True, context={'request': request}).data,
            'sent': FriendRequestSerializer(sent, many=True, context={'request': request}).data,
        })

    def post(self, request):
        receiver_id = request.data.get('user_id')
        if not receiver_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            receiver = get_user_model().objects.get(id=receiver_id)
        except get_user_model().DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        if receiver == request.user:
            return Response(
                {'error': 'You cannot send a friend request to yourself'},
                status=status.HTTP_400_BAD_REQUEST
            )

        existing = FriendRequest.objects.filter(
            Q(sender=request.user, receiver=receiver) |
            Q(sender=receiver, receiver=request.user)
        ).first()

        if existing:
            if existing.status == 'accepted':
                return Response({'error': 'You are already friends'}, status=status.HTTP_400_BAD_REQUEST)
            if existing.status == 'pending':
                if existing.sender == request.user:
                    return Response({'error': 'Friend request already sent'}, status=status.HTTP_400_BAD_REQUEST)
                # The other person already sent us a request — auto-accept
                existing.status = 'accepted'
                existing.save()
                _notify_friend_request_accepted(existing)
                _auto_accept_message_request(existing.sender, existing.receiver)
                return Response(
                    FriendRequestSerializer(existing, context={'request': request}).data,
                    status=status.HTTP_200_OK,
                )
            if existing.status == 'rejected':
                existing.status = 'pending'
                existing.sender = request.user
                existing.receiver = receiver
                existing.save()
                _notify_friend_request_sent(existing)
                return Response(
                    FriendRequestSerializer(existing, context={'request': request}).data,
                    status=status.HTTP_201_CREATED,
                )

        fr = FriendRequest.objects.create(sender=request.user, receiver=receiver)
        _notify_friend_request_sent(fr)
        return Response(
            FriendRequestSerializer(fr, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class FriendRequestApproveView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, request_id):
        fr = FriendRequest.objects.filter(
            Q(id=request_id) | Q(sender_id=request_id),
            receiver=request.user,
            status='pending'
        ).first()
        if not fr:
            return Response({'error': 'Friend request not found'}, status=status.HTTP_404_NOT_FOUND)
        fr.status = 'accepted'
        fr.save()
        _notify_friend_request_accepted(fr)
        # Auto-accept any pending MessageRequest between the two users.
        _auto_accept_message_request(fr.sender, fr.receiver)
        return Response(FriendRequestSerializer(fr, context={'request': request}).data)


class FriendRequestRejectView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, request_id):
        fr = FriendRequest.objects.filter(
            Q(id=request_id) | Q(sender_id=request_id),
            receiver=request.user,
            status='pending'
        ).first()
        if not fr:
            return Response({'error': 'Friend request not found'}, status=status.HTTP_404_NOT_FOUND)
        fr.status = 'rejected'
        fr.save()
        return Response(FriendRequestSerializer(fr, context={'request': request}).data)


class FriendRequestCancelView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, request_id):
        try:
            fr = FriendRequest.objects.filter(
                Q(id=request_id) | Q(receiver_id=request_id),
                sender=request.user,
                status='pending'
            ).first()
            if not fr:
                return Response({'error': 'Friend request not found'}, status=status.HTTP_404_NOT_FOUND)
            fr.delete()
            return Response({'message': 'Friend request cancelled'}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class MessageRequestApproveView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, request_id):
        msg_req = MessageRequest.objects.select_related(
            'sender', 'receiver', 'conversation'
        ).filter(
            Q(id=request_id) | Q(conversation_id=request_id)
        ).filter(
            Q(receiver=request.user) | Q(sender=request.user)
        ).first()

        if not msg_req:
            try:
                conv = Conversation.objects.get(id=request_id, participants__user=request.user)
                other_p = conv.participants.exclude(user=request.user).first()
                other_user = other_p.user if other_p else request.user
                msg_req, _ = MessageRequest.objects.get_or_create(
                    conversation=conv,
                    defaults={'sender': other_user, 'receiver': request.user, 'status': 'accepted'}
                )
            except Exception:
                return Response({'error': 'Message request not found'}, status=status.HTTP_404_NOT_FOUND)

        msg_req.status = 'accepted'
        msg_req.save()
        _notify_message_request_accepted(msg_req)

        # Broadcast via WebSocket
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer:
                event_data = {
                    'conversation_id': msg_req.conversation_id,
                    'status': 'accepted',
                    'sender_id': msg_req.sender_id,
                    'receiver_id': msg_req.receiver_id
                }
                # Broadcast to chat room
                async_to_sync(channel_layer.group_send)(
                    f'chat_{msg_req.conversation_id}',
                    {
                        'type': 'message_request_status',
                        'data': event_data
                    }
                )
                # Broadcast to sender and receiver update groups
                for u_id in [msg_req.sender_id, msg_req.receiver_id]:
                    async_to_sync(channel_layer.group_send)(
                        f'user_updates_{u_id}',
                        {
                            'type': 'message_request_status',
                            'data': event_data
                        }
                    )
        except Exception as ws_err:
            print(f"Warning: WebSocket broadcast for message request approve failed: {ws_err}")

        return Response({
            'message': 'Message request accepted',
            'conversation_id': msg_req.conversation_id,
        })


class MessageRequestRejectView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, request_id):
        msg_req = MessageRequest.objects.select_related(
            'sender', 'receiver', 'conversation'
        ).filter(
            Q(id=request_id) | Q(conversation_id=request_id)
        ).filter(
            Q(receiver=request.user) | Q(sender=request.user)
        ).first()

        if not msg_req:
            try:
                conv = Conversation.objects.get(id=request_id, participants__user=request.user)
                other_p = conv.participants.exclude(user=request.user).first()
                other_user = other_p.user if other_p else request.user
                msg_req, _ = MessageRequest.objects.get_or_create(
                    conversation=conv,
                    defaults={'sender': other_user, 'receiver': request.user, 'status': 'rejected'}
                )
            except Exception:
                return Response({'error': 'Message request not found'}, status=status.HTTP_404_NOT_FOUND)

        msg_req.status = 'rejected'
        msg_req.save()

        # Broadcast via WebSocket
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer:
                event_data = {
                    'conversation_id': msg_req.conversation_id,
                    'status': 'rejected',
                    'sender_id': msg_req.sender_id,
                    'receiver_id': msg_req.receiver_id
                }
                # Broadcast to chat room
                async_to_sync(channel_layer.group_send)(
                    f'chat_{msg_req.conversation_id}',
                    {
                        'type': 'message_request_status',
                        'data': event_data
                    }
                )
                # Broadcast to sender and receiver update groups
                for u_id in [msg_req.sender_id, msg_req.receiver_id]:
                    async_to_sync(channel_layer.group_send)(
                        f'user_updates_{u_id}',
                        {
                            'type': 'message_request_status',
                            'data': event_data
                        }
                    )
        except Exception as ws_err:
            print(f"Warning: WebSocket broadcast for message request reject failed: {ws_err}")

        return Response({'message': 'Message request declined'})

