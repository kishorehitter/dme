"""
WebSocket consumers for real-time chat.
"""
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from asgiref.sync import sync_to_async
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken
from .models import Conversation, ConversationParticipant, Message

User = get_user_model()

# Global tracking of which conversation each user is currently viewing
# Key: user_id, Value: conversation_id
user_active_conversations = {}


class NotificationConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for global notifications.
    """

    async def connect(self):
        self.user = await self.get_user_from_token()
        if not self.user or not self.user.is_authenticated:
            await self.close(code=4001)
            return
        
        self.user_group_name = f'user_updates_{self.user.id}'
        await self.channel_layer.group_add(
            self.user_group_name,
            self.channel_name
        )
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'user_group_name'):
            await self.channel_layer.group_discard(
                self.user_group_name,
                self.channel_name
            )

    async def new_message_summary(self, event):
        """Send message update to WebSocket."""
        print(f"   📨 NotificationConsumer: Broadcasting new_message_summary to user_updates_{self.user.id}")
        await self.send(text_data=json.dumps({
            'type': 'new_message_summary',
            'data': event['data']
        }))
        
    async def delivered(self, event):
        """Handle delivery receipt notification."""
        await self.send(text_data=json.dumps({
            'type': 'delivered',
            'data': event['data']
        }))

    async def read_receipt(self, event):
        """Handle read receipt notification."""
        await self.send(text_data=json.dumps({
            'type': 'read_receipt',
            'data': event['data']
        }))

    async def get_user_from_token(self):
        """Get user from JWT token in query params."""
        from rest_framework_simplejwt.tokens import AccessToken
        try:
            query_params = self.scope.get('query_string', b'').decode()
            params = dict(param.split('=') for param in query_params.split('&') if '=' in param)
            token = params.get('token', '')

            if not token:
                return None

            access_token = AccessToken(token)
            user_id = access_token['user_id']
            return await self.get_user(user_id)
        except Exception as e:
            print(f"Error authenticating WebSocket token: {e}")
            return None

    @database_sync_to_async
    def get_user(self, user_id):
        from accounts.models import User
        try:
            return User.objects.get(id=user_id)
        except User.DoesNotExist:
            return None


class ChatConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for real-time chat.

    Connection URL: ws://localhost:8000/ws/chat/{conversation_id}/?token=JWT_TOKEN
    """

    async def connect(self):
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']
        self.room_group_name = f'chat_{self.conversation_id}'

        # Authenticate user from JWT token in query params
        self.user = await self.get_user_from_token()

        print(f"   🔌 WebSocket CONNECT: user={self.user.id if self.user else None}, conversation={self.conversation_id}, room={self.room_group_name}")

        if not self.user or not self.user.is_authenticated:
            print(f"   ❌ WebSocket rejected: user not authenticated")
            await self.close(code=4001)
            return

        # Verify user is a participant of this conversation
        is_participant = await self.is_conversation_participant(
            self.conversation_id,
            self.user.id
        )

        if not is_participant:
            print(f"   ❌ WebSocket rejected: user not participant")
            await self.close(code=4003)
            return

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        
        # Join user-specific update group
        self.user_group_name = f'user_updates_{self.user.id}'
        await self.channel_layer.group_add(
            self.user_group_name,
            self.channel_name
        )

        await self.accept()
        print(f"   ✅ WebSocket ACCEPTED: user={self.user.id}, conversation={self.conversation_id}")

        # Send confirmation
        await self.send(text_data=json.dumps({
            'type': 'connection_established',
            'conversation_id': self.conversation_id,
            'message': 'Connected to chat room'
        }))

        # Track which conversation this user is viewing
        user_active_conversations[self.user.id] = self.conversation_id
        print(f"   📍 User {self.user.id} now viewing conversation {self.conversation_id}")

        # Clear last_seen when user connects (they're online now)
        await self.update_last_seen(online=True)

        # Mark any undelivered messages as delivered (user was offline, now connected)
        await self.mark_undelivered_messages_as_delivered()

    async def mark_undelivered_messages_as_delivered(self):
        """Mark all undelivered messages in this conversation as delivered for this user."""
        @database_sync_to_async
        def _mark_delivered():
            from .models import Message, ConversationParticipant
            # Get the sender(s) in this conversation (messages not sent by current user)
            # Mark all messages that were sent by others and don't have delivered_at yet
            count = Message.objects.filter(
                conversation_id=self.conversation_id
            ).exclude(
                sender=self.user
            ).filter(
                delivered_at__isnull=True
            ).update(delivered_at=timezone.now())
            if count > 0:
                print(f"   ✅ Marked {count} undelivered message(s) as delivered for user {self.user.id}")
        await _mark_delivered()
    async def disconnect(self, close_code):
        """Update last_seen and notify room when user disconnects."""
        # Broadcast that user stopped typing
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'typing_indicator',
                'user_id': self.user.id,
                'user_name': self.user.display_name,
                'is_typing': False
            }
        )

        # Leave room group
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )
        
        # Leave user-specific update group
        await self.channel_layer.group_discard(
            self.user_group_name,
            self.channel_name
        )
        
        # Remove from active conversations tracking
        if self.user.id in user_active_conversations:
            del user_active_conversations[self.user.id]
            print(f"   📍 User {self.user.id} left conversation {self.conversation_id}")
        
        # Set last_seen to current time (user went offline)
        await self.update_last_seen(online=False)

    @database_sync_to_async
    def update_last_seen(self, online: bool = False):
        """Update user's last_seen timestamp."""
        if online:
            # User is online - clear last_seen
            self.user.last_seen = None
        else:
            # User went offline - set last_seen to now
            from django.utils import timezone
            self.user.last_seen = timezone.now()
        self.user.save(update_fields=['last_seen'])

    async def receive(self, text_data):
        """Receive message from WebSocket."""
        print(f"   📩 WebSocket RECEIVE: {text_data[:100]}")
        try:
            data = json.loads(text_data)
            message_type = data.get('type', 'message')
            print(f"   📩 Message type: {message_type}")

            if message_type == 'message':
                await self.handle_message(data)
            elif message_type == 'typing':
                await self.handle_typing(data)
            elif message_type == 'read':
                await self.handle_read(data)
            elif message_type == 'reaction':
                await self.handle_reaction(data)
        except Exception as e:
            print(f"   ❌ WebSocket RECEIVE ERROR: {e}")
            raise

    async def handle_message(self, data):
        """Handle new message."""
        from accounts.models import UserBlock
        from asgiref.sync import sync_to_async

        # Check if sender is blocked by any participant in the conversation
        is_blocked = await self.check_if_blocked()
        if is_blocked:
            print(f"   🚫 Message blocked: user {self.user.id} is blocked")
            return

        content = data.get('content', '')
        message_type = data.get('message_type', 'text')
        reply_to_id = data.get('reply_to')  # Extract reply_to from WebSocket data
        duration = data.get('duration')  # Extract duration for audio messages

        if not content and message_type == 'text':
            return

        # Save message to database
        message = await self.save_message(
            self.conversation_id,
            self.user.id,
            content,
            message_type,
            reply_to_id,  # Pass reply_to_id
            duration  # Pass duration
        )

        if message:
            # Send message to room group
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'chat_message',
                    'message': message
                }
            )

            # Notify participants of a new message update
            participants = await self.get_conversation_participants_async()
            for p_id in participants:
                await self.channel_layer.group_send(
                    f'user_updates_{p_id}',
                    {
                        'type': 'new_message_summary',
                        'data': message
                    }
                )

            # Send FCM push notification to offline recipients
            await self.send_fcm_notification(
                message,
                self.user.id
            )

    @sync_to_async
    def check_if_blocked(self):
        """Check if the current user is blocked by any participant in the conversation."""
        from accounts.models import UserBlock, User
        
        # Get all participants in the conversation
        participants = self.get_conversation_participants()
        
        # Check if any participant has blocked the current user
        for participant_id in participants:
            if participant_id != self.user.id:
                is_blocked = self.is_user_blocked(participant_id, self.user.id)
                if is_blocked:
                    return True
        return False
    
    def get_conversation_participants(self):
        """Get list of participant user IDs in the conversation."""
        from chat.models import ConversationParticipant
        participants = ConversationParticipant.objects.filter(conversation_id=self.conversation_id)
        return [p.user_id for p in participants]
    
    @database_sync_to_async
    def get_conversation_participants_async(self):
        """Get list of participant user IDs in the conversation."""
        from chat.models import ConversationParticipant
        participants = ConversationParticipant.objects.filter(conversation_id=self.conversation_id)
        return [p.user_id for p in participants]
    
    def is_user_blocked(self, blocker_id, blocked_id):
        """Check if a user is blocked by another user."""
        from accounts.models import UserBlock
        return UserBlock.objects.filter(blocker_id=blocker_id, blocked_id=blocked_id).exists()

    async def handle_typing(self, data):
        """Handle typing indicator."""
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'typing_indicator',
                'user_id': self.user.id,
                'user_name': self.user.display_name,
                'is_typing': data.get('is_typing', True)
            }
        )

    async def handle_read(self, data):
        """Handle read receipt."""
        message_ids = data.get('message_ids', [])

        # Mark messages as read
        await self.mark_messages_read(message_ids)

        # Broadcast to room
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'read_receipt',
                'message_ids': message_ids,
                'user_id': self.user.id
            }
        )
        
        # Broadcast to notification stream of original message senders
        from chat.models import Message
        for m_id in message_ids:
            try:
                msg = await sync_to_async(Message.objects.get)(id=m_id)
                await self.channel_layer.group_send(
                    f'user_updates_{msg.sender_id}',
                    {
                        'type': 'read_receipt',
                        'data': {
                            'message_ids': [m_id],
                            'user_id': self.user.id
                        }
                    }
                )
            except: pass

    async def handle_reaction(self, data):
        """Handle message reaction."""
        message_id = data.get('message_id')
        emoji = data.get('emoji')

        if not message_id:
            return

        print(f"   ❤️ Reaction: message {message_id}, emoji {emoji} by user {self.user.id}")

        # Save to DB and get all reactions for this message
        reactions = await self.save_message_reaction(message_id, emoji)

        print(f"   📡 Broadcasting reaction to room {self.room_group_name}: message={message_id}, reactions={reactions}")

        # Broadcast to room
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'broadcast_reaction',
                'message_id': message_id,
                'reactions': reactions
            }
        )
        print(f"   ✅ Reaction broadcast sent")

    @database_sync_to_async
    def save_message_reaction(self, message_id, emoji):
        """Save reaction to database and return all reactions for the message."""
        from .models import Message, MessageReaction
        try:
            message = Message.objects.get(id=message_id)
            
            if emoji:
                # Add or update reaction
                reaction, created = MessageReaction.objects.update_or_create(
                    message=message,
                    user=self.user,
                    defaults={'emoji': emoji}
                )
            else:
                # Remove reaction if emoji is empty
                MessageReaction.objects.filter(
                    message=message,
                    user=self.user
                ).delete()
            
            # Get all reactions for this message
            all_reactions = MessageReaction.objects.filter(message=message)
            return {str(r.user_id): r.emoji for r in all_reactions}
        except Exception as e:
            print(f"Error saving reaction: {e}")
            return {}

    async def broadcast_reaction(self, event):
        """Send reaction update to WebSocket."""
        print(f"   📨 broadcast_reaction called for user {self.user.id}: message={event.get('message_id')}, reactions={event.get('reactions')}")
        await self.send(text_data=json.dumps({
            'type': 'reaction',
            'data': {
                'message_id': event['message_id'],
                'reactions': event['reactions']
            }
        }))
        print(f"   ✅ Reaction sent to user {self.user.id}")

    async def new_message_summary(self, event):
        """Handle new message summary notification."""
        await self.send(text_data=json.dumps({
            'type': 'new_message_summary',
            'data': event['data']
        }))

    async def delivery_update(self, event):
        """Handle delivery receipt notification."""
        await self.send(text_data=json.dumps({
            'type': 'delivered',
            'data': {
                'message_ids': event['message_ids'],
                'user_id': event['user_id']
            }
        }))

    async def read_receipt(self, event):
        """Handle read receipt notification."""
        await self.send(text_data=json.dumps({
            'type': 'read_receipt',
            'data': {
                'message_ids': event['message_ids'],
                'user_id': event['user_id']
            }
        }))

    async def chat_message(self, event):
        """Send chat message to WebSocket and mark as delivered (if recipient)."""
        message = event['message']
        message_sender_id = message.get('sender', {}).get('id')
        
        if message_sender_id and message_sender_id != self.user.id:
            await self.mark_message_delivered(message.get('id'))
            await self.notify_sender_delivered(message.get('id'), message_sender_id)

        await self.send(text_data=json.dumps({
            'type': 'message',
            'data': message
        }))

    async def notify_sender_delivered(self, message_id, sender_id):
        """Send delivery notification to sender's WebSocket connection."""
        # Send delivery update to the sender in the same room
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'delivery_update',
                'message_ids': [message_id],
                'user_id': self.user.id,  # recipient who received the message
            }
        )

    async def delivery_update(self, event):
        """Handle delivery update event (notify sender)."""
        # Only send to the sender (not the recipient)
        if self.user.id == event.get('user_id'):
            # This is the recipient, don't send delivery update to themselves
            return
            
        await self.send(text_data=json.dumps({
            'type': 'delivered',
            'data': {
                'message_ids': event['message_ids'],
                'user_id': event['user_id'],
            }
        }))

    async def mark_message_delivered(self, message_id):
        """Mark message as delivered when it reaches recipient's device."""
        from channels.db import database_sync_to_async
        
        @database_sync_to_async
        def _update_delivered():
            Message.objects.filter(
                id=message_id,
                delivered_at__isnull=True
            ).update(delivered_at=timezone.now())
        
        await _update_delivered()

    async def typing_indicator(self, event):
        """Send typing indicator to WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'typing',
            'data': {
                'user_id': event['user_id'],
                'user_name': event['user_name'],
                'is_typing': event['is_typing']
            }
        }))

    async def read_receipt(self, event):
        """Send read receipt to WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'read_receipt',
            'data': {
                'message_ids': event['message_ids'],
                'user_id': event['user_id']
            }
        }))

    async def delivery_message(self, event):
        """Send delivery receipt to WebSocket (notifies sender that message was delivered)."""
        await self.send(text_data=json.dumps({
            'type': 'delivered',
            'data': {
                'message_ids': event['message_ids'],
                'user_id': event['user_id']
            }
        }))

    async def group_call_event(self, event):
        """Send group call notification to WebSocket."""
        await self.send(text_data=json.dumps({
            'type': 'group_call',
            'data': {
                'event': event['event'],
                'user_id': event['user_id'],
                'user_name': event['user_name'],
                'call_id': event['call_id']
            }
        }))

    async def get_user_from_token(self):
        """Get user from JWT token in query params."""
        try:
            query_params = self.scope.get('query_string', b'').decode()
            params = dict(param.split('=') for param in query_params.split('&') if '=' in param)
            token = params.get('token', '')
            
            if not token:
                return None
            
            access_token = AccessToken(token)
            user_id = access_token['user_id']
            return await self.get_user(user_id)
        except Exception as e:
            print(f"Error authenticating WebSocket token: {e}")
            return None

    @database_sync_to_async
    def get_user(self, user_id):
        """Get user by ID."""
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None

    @database_sync_to_async
    def is_conversation_participant(self, conversation_id, user_id):
        """Check if user is a participant of the conversation."""
        return ConversationParticipant.objects.filter(
            conversation_id=conversation_id,
            user_id=user_id
        ).exists()

    @database_sync_to_async
    def save_message(self, conversation_id, user_id, content, message_type, reply_to_id=None, duration=None):
        """Save message to database."""
        try:
            conversation = Conversation.objects.get(pk=conversation_id)
            user = User.objects.get(pk=user_id)

            # Prepare message data
            message_data = {
                'conversation': conversation,
                'sender': user,
                'content': content,
                'message_type': message_type,
            }
            
            # Add reply_to if provided
            if reply_to_id:
                try:
                    reply_message = Message.objects.get(id=reply_to_id)
                    message_data['reply_to'] = reply_message
                except Message.DoesNotExist:
                    pass  # Ignore if reply_to message doesn't exist
            
            # Add audio_duration if provided
            if duration:
                try:
                    message_data['audio_duration'] = int(duration)
                except (ValueError, TypeError):
                    pass  # Ignore if duration is invalid

            message = Message.objects.create(**message_data)

            # Update conversation updated_at
            conversation.save()

            return {
                'id': message.id,
                'conversation': message.conversation_id,
                'sender': {
                    'id': message.sender.id,
                    'email': message.sender.email,
                    'display_name': message.sender.display_name,
                    'profile_picture': message.sender.profile_picture.url if message.sender.profile_picture else None,
                },
                'content': message.content,
                'message_type': message.message_type,
                'is_read': False,
                'created_at': message.created_at.isoformat(),
                'audio_duration': message.audio_duration,
                'reply_to': {
                    'id': message.reply_to.id,
                    'content': message.reply_to.content,
                    'sender': {
                        'id': message.reply_to.sender.id,
                        'display_name': message.reply_to.sender.display_name or message.reply_to.sender.first_name or message.reply_to.sender.email,
                    }
                } if message.reply_to else None,
            }
        except Exception as e:
            print(f"Error saving message: {e}")
            return None

    @database_sync_to_async
    def mark_messages_read(self, message_ids):
        """Mark messages as read."""
        Message.objects.filter(id__in=message_ids).update(is_read=True)

    @database_sync_to_async
    def send_fcm_notification(self, message, sender_id):
        """
        Send FCM push notification to recipients who are NOT viewing this conversation.
        Includes conversation/group name in payload.
        """
        try:
            from notifications.fcm_service import FCMService
            from .models import Message as MessageModel, Conversation
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync

            conversation_id = message.get('conversation')
            
            # Fetch conversation name (group name or sender name)
            conversation = Conversation.objects.get(id=conversation_id)
            # Use conversation name if it's a group, otherwise use sender name
            group_name = conversation.name if conversation.is_group else None
            
            sender_name = message.get('sender', {}).get('display_name') or message.get('sender', {}).get('email', 'Someone')
            message_content = message.get('content', '')
            message_type = message.get('message_type', 'text')
            message_id = message.get('id')

            # Build the title: Group Name + Sender Name or just Sender Name
            notification_title = f"{group_name} - {sender_name}" if group_name else sender_name

            print(f"   🔔 FCM Notification triggered for conversation {conversation_id}")
            print(f"      - Title: {notification_title}")

            participants = ConversationParticipant.objects.filter(
                conversation_id=conversation_id
            ).exclude(user_id=sender_id)

            for participant in participants:
                recipient = participant.user

                # Send FCM notification
                # Update FCMService call to use the constructed title
                result = FCMService.send_chat_notification(
                    recipient=recipient,
                    sender_name=notification_title, # Pass the combined title
                    message_content=message_content,
                    conversation_id=conversation_id,
                    message_id=message_id,
                    message_type=message_type
                )

                if result > 0:
                    MessageModel.objects.filter(
                        id=message_id,
                        delivered_at__isnull=True
                    ).update(delivered_at=timezone.now())
                    
                    channel_layer = get_channel_layer()
                    room_group_name = f'chat_{conversation_id}'
                    async_to_sync(channel_layer.group_send)(
                        room_group_name,
                        {
                            'type': 'delivery_update',
                            'message_ids': [message_id],
                            'user_id': recipient.id,
                        }
                    )
        except Exception as e:
            print(f"   ❌ Error sending FCM notification: {e}")
            import traceback
            traceback.print_exc()
