"""
Firebase Cloud Messaging service for sending push notifications.
"""
import logging
import datetime
from firebase_admin import messaging
from firebase_admin.exceptions import FirebaseError
from django.utils import timezone
from datetime import timedelta
from accounts.models import FCMDevice, User

logger = logging.getLogger(__name__)


class FCMService:
    """Service for sending FCM push notifications."""

    @staticmethod
    def get_user_active_devices(user):
        """Get all active FCM devices for a user."""
        return FCMDevice.objects.filter(user=user, is_active=True)

    @staticmethod
    def send_to_token(token, notification, data=None):
        """
        Send a notification to a specific device token.

        Args:
            token: FCM registration token
            notification: dict with 'title' and 'body', or None for data-only messages
            data: Optional dict with custom data payload

        Returns:
            messaging.SendResponse or None if failed
        """
        try:
            # Support data-only messages (notification=None)
            if notification:
                message = messaging.Message(
                    notification=messaging.Notification(
                        title=notification.get('title', ''),
                        body=notification.get('body', ''),
                    ),
                    data=data or {},
                    token=token,
                    # High priority for Android to wake up device
                    android=messaging.AndroidConfig(
                        priority='high',
                        ttl=datetime.timedelta(seconds=30),
                    ),
                    # High priority for iOS to wake up device
                    apns=messaging.APNSConfig(
                        payload=messaging.APNSPayload(
                            aps=messaging.Aps(content_available=True)
                        ),
                    ),
                )
            else:
                # Data-only message - no notification payload
                message = messaging.Message(
                    data=data or {},
                    token=token,
                    # High priority for Android to wake up device
                    android=messaging.AndroidConfig(
                        priority='high',
                        ttl=datetime.timedelta(seconds=30),
                    ),
                    # High priority for iOS to wake up device
                    apns=messaging.APNSConfig(
                        payload=messaging.APNSPayload(
                            aps=messaging.Aps(content_available=True)
                        ),
                    ),
                )
            
            response = messaging.send(message)
            logger.info(f"Successfully sent FCM notification: {response}")
            return response
        except FirebaseError as e:
            logger.error(f"FCM send error: {e}")
            # Check if token is invalid/expired
            if e.code in ['messaging/invalid-argument', 'messaging/registration-token-not-registered']:
                logger.warning(f"Invalid token, marking device as inactive: {token[:20]}...")
                FCMDevice.objects.filter(registration_token=token).update(is_active=False)
            return None
        except Exception as e:
            logger.error(f"Unexpected FCM error: {e}")
            return None

    @staticmethod
    def send_to_tokens(tokens, notification, data=None):
        """
        Send a notification to multiple device tokens.

        Args:
            tokens: List of FCM registration tokens
            notification: dict with 'title' and 'body', or None for data-only messages
            data: Optional dict with custom data payload

        Returns:
            messaging.BatchResponse
        """
        if not tokens:
            return None

        # Firebase supports max 500 tokens per batch
        tokens = tokens[:500]

        try:
            # Support data-only messages (notification=None)
            if notification:
                message = messaging.MulticastMessage(
                    notification=messaging.Notification(
                        title=notification.get('title', ''),
                        body=notification.get('body', ''),
                    ),
                    data=data or {},
                    tokens=tokens,
                    # High priority for Android to wake up device
                    android=messaging.AndroidConfig(
                        priority='high',
                        ttl=datetime.timedelta(seconds=30),
                    ),
                    # High priority for iOS to wake up device
                    apns=messaging.APNSConfig(
                        payload=messaging.APNSPayload(
                            aps=messaging.Aps(content_available=True)
                        ),
                    ),
                )
            else:
                # Data-only message - no notification payload
                message = messaging.MulticastMessage(
                    data=data or {},
                    tokens=tokens,
                    # High priority for Android to wake up device
                    android=messaging.AndroidConfig(
                        priority='high',
                        ttl=datetime.timedelta(seconds=30),
                    ),
                    # High priority for iOS to wake up device
                    apns=messaging.APNSConfig(
                        payload=messaging.APNSPayload(
                            aps=messaging.Aps(content_available=True)
                        ),
                    ),
                )
            
            # send_multicast is deprecated/removed in firebase-admin 7.x
            # use send_each_for_multicast instead
            response = messaging.send_each_for_multicast(message)
            logger.info(f"FCM batch send: {response.success_count}/{len(tokens)} successful")

            # Mark failed tokens as inactive
            if response.failure_count > 0:
                for idx, resp in enumerate(response.responses):
                    if not resp.success:
                        FCMDevice.objects.filter(registration_token=tokens[idx]).update(is_active=False)

            return response
        except FirebaseError as e:
            logger.error(f"FCM batch send error: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected FCM batch error: {e}")
            return None

    @staticmethod
    def send_to_user(user, notification, data=None):
        """
        Send notification to all active devices of a user.
        
        Args:
            user: User instance
            notification: dict with 'title' and 'body'
            data: Optional dict with custom data payload
            
        Returns:
            Number of successful sends
        """
        devices = FCMService.get_user_active_devices(user)
        # ✅ Deduplicate tokens (in case same token registered with multiple device_ids)
        tokens = list(set([device.registration_token for device in devices]))
        
        if not tokens:
            logger.debug(f"No active FCM devices for user {user.email}")
            return 0

        if len(tokens) == 1:
            response = FCMService.send_to_token(tokens[0], notification, data)
            return 1 if response else 0
        
        response = FCMService.send_to_tokens(tokens, notification, data)
        return response.success_count if response else 0

    @staticmethod
    def send_to_users(users, notification, data=None):
        """
        Send notification to multiple users.
        
        Args:
            users: QuerySet or list of User instances
            notification: dict with 'title' and 'body'
            data: Optional dict with custom data payload
            
        Returns:
            Number of successful sends
        """
        all_tokens = set()
        for user in users:
            devices = FCMService.get_user_active_devices(user)
            for device in devices:
                all_tokens.add(device.registration_token)
        
        tokens = list(all_tokens)
        if not tokens:
            logger.debug("No active FCM devices for any users")
            return 0

        response = FCMService.send_to_tokens(tokens, notification, data)
        return response.success_count if response else 0

    @staticmethod
    def send_chat_notification(
        recipient,
        sender_name,
        message_content,
        conversation_id,
        message_id=None,
        message_type='text',
        sender_avatar=None
    ):
        """
        Send a chat message notification to a user.
        
        IMPORTANT: We send DATA-ONLY messages (no notification payload).
        This ensures the app's setBackgroundMessageHandler receives the message
        and can display a custom Notifee notification with reply action button.
        """
        # Truncate message content for notification
        if len(message_content) > 100:
            message_content = message_content[:97] + '...'

        # DATA-ONLY message - no notification payload!
        # The app will receive this and display via Notifee with action buttons
        data = {
            'type': 'new_message',
            'conv_id': str(conversation_id),
            'sender': sender_name,
            'msg_type': str(message_type),
            'ts': timezone.now().isoformat(),
            # For Notifee notification display:
            'notif_title': sender_name,
            'notif_body': message_content,
        }

        if message_id:
            data['msg_id'] = str(message_id)
        if sender_avatar:
            data['sender_avatar'] = sender_avatar

        logger.info(f"Sending data-only FCM notification: sender={sender_name}, msg={message_content[:20]}...")

        # Send data-only (no notification payload)
        return FCMService.send_to_user(recipient, None, data)

    @staticmethod
    def send_missed_call_notification(recipient, caller_name, caller_id, call_id, call_type, conversation_id=None, caller_avatar=None):
        """Send missed call notification to receiver with callback button."""
        # DATA-ONLY message for missed call
        data = {
            'type': 'missed_call',
            'call_id': str(call_id),
            'caller_id': str(caller_id),
            'caller_name': caller_name,
            'call_type': call_type,
            # For Notifee display:
            'notif_title': 'Missed Call',
            'notif_body': f'You missed a {call_type} call from {caller_name}',
            'action': 'callback',
        }
        if conversation_id:
            data['conversation_id'] = str(conversation_id)
        if caller_avatar:
            data['caller_avatar'] = caller_avatar
            
        return FCMService.send_to_user(recipient, None, data)

    @staticmethod
    def send_cancel_call_notification(recipient, call_id):
        """Send notification to cancel/dismiss an active incoming call notification."""
        data = {
            'type': 'cancel_call',
            'call_id': str(call_id),
        }
        return FCMService.send_to_user(recipient, None, data)

    @staticmethod
    def send_group_call_notification(recipient, initiator_name, initiator_id, call_id, room_id, conversation, call_type):
        """Send group call notification with Answer/Decline buttons, including group name."""
        # Check if conversation is a group
        is_group = getattr(conversation, 'is_group', False)
        conv_name = getattr(conversation, 'name', None) or "Group"
        
        # Build dynamic title and body
        if is_group:
            title = f"Incoming {call_type} call from {conv_name}"
            body = f"{initiator_name} is calling from {conv_name}..."
        else:
            title = f"Incoming {call_type} call"
            body = f"{initiator_name} is calling..."
            
        data = {
            'type': 'incoming_call',
            'call_id': str(call_id),
            'caller_id': str(initiator_id),
            'caller_name': initiator_name,
            'call_type': f'group_{call_type}' if is_group else call_type,
            'room_id': str(room_id),
            'conversation_id': str(conversation.id),
            'notif_title': title,        # Ensure this is used by the client
            'notif_body': body,          # Ensure this is used by the client
        }
        return FCMService.send_to_user(recipient, None, data)

    @staticmethod
    def is_user_online(user):
        """
        Check if user is currently online (connected via WebSocket).
        Uses last_seen timestamp - considers online if seen within last 2 minutes.
        
        Args:
            user: User instance
            
        Returns:
            bool
        """
        # If last_seen is None, user is currently connected via WebSocket
        if not user.last_seen:
            return True
        
        # If last_seen is within 2 minutes, consider user online
        return user.last_seen > (timezone.now() - timedelta(minutes=2))


# Convenience functions
def send_chat_notification(recipient, sender_name, message_content, conversation_id, message_id=None, message_type='text'):
    """Send a chat notification to a user."""
    # WhatsApp-like behavior: Always send FCM if user is not in the specific chat
    # Logic moved to chat/consumers.py for better granularity, but we still allow it here
    return FCMService.send_chat_notification(
        recipient, sender_name, message_content, conversation_id, message_id, message_type
    )


def send_to_user(user, title, body, data=None):
    """Send notification to a user."""
    notification = {'title': title, 'body': body}
    return FCMService.send_to_user(user, notification, data)
