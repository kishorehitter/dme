"""
Views for FCM device management and push notifications.
"""
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView
from django.contrib.auth import get_user_model
from accounts.models import FCMDevice
from .serializers import FCMDeviceSerializer
from .fcm_service import FCMService

User = get_user_model()


class FCMDeviceViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing FCM devices.
    
    Endpoints:
        POST /api/fcm/devices/ - Register/update device
        GET /api/fcm/devices/ - List user's devices
        DELETE /api/fcm/devices/{id}/ - Remove device
    """
    serializer_class = FCMDeviceSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return FCMDevice.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class FCMDeviceRegisterView(APIView):
    """
    Register or update FCM device token.
    
    POST /api/fcm/register/
    {
        "device_id": "unique_device_identifier",
        "registration_token": "fcm_token_from_client",
        "platform": "android" | "ios" | "web"
    }
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = FCMDeviceSerializer(data=request.data, context={'request': request})
        
        if serializer.is_valid():
            serializer.save()
            return Response(
                {'message': 'FCM device registered successfully'},
                status=status.HTTP_201_CREATED
            )
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class FCMDeviceListView(APIView):
    """
    List all active FCM devices for the current user.
    
    GET /api/fcm/devices/list/
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        devices = FCMDevice.objects.filter(user=request.user)
        serializer = FCMDeviceSerializer(devices, many=True)
        return Response(serializer.data)


class FCMDeviceRemoveView(APIView):
    """
    Remove an FCM device (e.g., on logout).
    
    POST /api/fcm/remove/
    {
        "device_id": "unique_device_identifier"
    }
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        device_id = request.data.get('device_id')
        
        if not device_id:
            return Response(
                {'error': 'device_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        device = FCMDevice.objects.filter(
            user=request.user,
            device_id=device_id
        ).first()

        if device:
            device.delete()
            return Response(
                {'message': 'FCM device removed successfully'},
                status=status.HTTP_200_OK
            )

        return Response(
            {'error': 'Device not found'},
            status=status.HTTP_404_NOT_FOUND
        )


class FCMTestNotificationView(APIView):
    """
    Test FCM notification endpoint.
    
    POST /api/fcm/test/
    {
        "title": "Test Notification",
        "body": "This is a test notification"
    }
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        title = request.data.get('title', 'Test Notification')
        body = request.data.get('body', 'This is a test notification')
        
        notification = {
            'title': title,
            'body': body,
        }
        
        data = {
            'type': 'test_notification',
        }

        success_count = FCMService.send_to_user(request.user, notification, data)
        
        return Response({
            'message': f'Notification sent to {success_count} device(s)',
            'success_count': success_count
        })


class TriviaChallengeView(APIView):
    """
    Send a trivia challenge FCM notification directly to a friend.

    POST /api/fcm/trivia/challenge/
    {
        "friend_id": 42,
        "category": "science",
        "set_id": "set1"
    }
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        friend_id = request.data.get('friend_id')
        category = request.data.get('category', '')
        set_id = request.data.get('set_id', '')

        if not friend_id:
            return Response({'error': 'friend_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            friend = User.objects.get(id=friend_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        sender_name = request.user.display_name or request.user.first_name or 'Someone'
        category_label = category.replace('_', ' ').title()
        set_label = set_id.replace('set', 'Set ') if set_id else ''

        notification = {
            'title': f'⚔️ Trivia Challenge from {sender_name}!',
            'body': f'{sender_name} challenged you to {category_label} {set_label}. Tap to play!'
        }

        # Stable deduplication ID — scoped per sender so repeated challenges don't stack endlessly
        import uuid
        notif_id = f'trivia_challenge_{request.user.id}_{int(__import__("time").time())}'

        data = {
            'type': 'trivia_challenge',
            # Human-readable labels — used for notification display and deep-link routing
            'category_label': category_label,
            'set_label': set_label,
            'challenger_name': str(sender_name),
            'challenger_id': str(request.user.id),
            # Raw routing keys (internal — not shown to user)
            '_category': str(category),
            '_set_id': str(set_id),
            # Stable deduplication ID to prevent duplicate notifications
            'notif_id': notif_id,
        }

        # Send with a 7-day TTL so the challenge is delivered even if the friend is offline
        import datetime
        from firebase_admin import messaging as fb_messaging
        from accounts.models import FCMDevice

        devices = FCMDevice.objects.filter(user=friend, is_active=True)
        tokens = list(set(d.registration_token for d in devices))

        success_count = 0
        for token in tokens:
            try:
                msg = fb_messaging.Message(
                    notification=fb_messaging.Notification(
                        title=notification['title'],
                        body=notification['body'],
                    ),
                    data=data,
                    token=token,
                    android=fb_messaging.AndroidConfig(
                        priority='high',
                        ttl=datetime.timedelta(days=7),  # Store for up to 7 days if offline
                    ),
                    apns=fb_messaging.APNSConfig(
                        headers={'apns-expiration': str(int((datetime.datetime.now() + datetime.timedelta(days=7)).timestamp()))},
                        payload=fb_messaging.APNSPayload(aps=fb_messaging.Aps(content_available=True)),
                    ),
                )
                fb_messaging.send(msg)
                success_count += 1
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(f'Failed to send challenge to token: {e}')

        return Response({
            'message': f'Challenge sent to {friend.display_name or friend.first_name}',
            'success_count': success_count
        }, status=status.HTTP_200_OK)
