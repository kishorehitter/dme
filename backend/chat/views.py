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

class HealthCheckView(APIView):
    """Simple ping endpoint for keep-alive."""
    permission_classes = [] # Allow anyone to ping

    def get(self, request):
        return Response({'status': 'ok'}, status=status.HTTP_200_OK)

from .models import Conversation, ConversationParticipant, Message, MessageReaction, Status
from .serializers import (
    ConversationSerializer,
    ConversationListSerializer,
    ConversationCreateSerializer,
    MessageSerializer,
    MessageReactionSerializer,
    UserMinimalSerializer,
)

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
        return Conversation.objects.filter(
            participants__user=self.request.user
        ).prefetch_related('participants__user', 'messages').distinct().order_by('-updated_at')

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
            
            if 'profile_picture' in request.FILES:
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

        # WhatsApp-style: Broadcast message via WebSocket and trigger FCM
        self.broadcast_and_notify(message)

        # Update conversation updated_at timestamp
        conversation.save()

        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

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
                    message_type=message.message_type
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
    """Search users to start conversation with by exact username match."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        query = request.query_params.get('q', '')
        if not query:
            return Response([])
            
        User = get_user_model()

        # Strict exact match for username
        users = User.objects.filter(
            username=query
        ).exclude(id=request.user.id)[:20]

        serializer = UserMinimalSerializer(users, many=True, context={'request': request})
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


class MessageEditView(APIView):
    """Edit a message (sender only)."""
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
            return Response(serializer.data)
        except Message.DoesNotExist:
            return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)


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
                # Sender can unsend (delete for everyone)
                # For now, we'll soft delete with is_deleted flag
                # You can change this to message.delete() for hard delete
                message.is_deleted = True
                message.content = 'The message was removed'
                message.save()
                return Response({'message': 'Message unsent for everyone'})
            else:
                # Receiver can only delete for themselves (soft delete)
                # We'll use a custom flag or just hide it on frontend
                # For now, mark as deleted
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

