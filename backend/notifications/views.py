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
