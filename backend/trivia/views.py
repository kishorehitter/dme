from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from .models import TriviaChallenge
from chat.models import Conversation, Message

User = get_user_model()

BACKEND_HOST = 'https://dme-19zq.onrender.com'


class CreateTriviaChallengeView(APIView):
    """
    POST /api/trivia/challenge/create/
    { "friend_id": 42, "category": "science", "set_id": "set1" }
    Creates a one-time challenge token and sends it as an FCM notification.
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

        # Create the challenge token
        challenge = TriviaChallenge.objects.create(
            challenger=request.user,
            recipient=friend,
            category=category,
            set_id=set_id,
        )

        sender_name = (
            getattr(request.user, 'display_name', None)
            or request.user.first_name
            or 'Someone'
        )
        category_label = category.replace('_', ' ').title()
        set_label = set_id.replace('set', 'Set ') if set_id else ''

        # Prepare FCM Notification payload
        notification = {
            'title': f'⚔️ Trivia Challenge from {sender_name}!',
            'body': f'{sender_name} challenged you to {category_label} {set_label}. Tap to play!'
        }

        data = {
            'type': 'trivia_challenge_token',
            'challengeToken': str(challenge.token),
            'challenger_name': str(sender_name),
            'challenger_id': str(request.user.id),
        }

        # Send FCM directly to all active devices of the friend
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
                        ttl=datetime.timedelta(days=7),  # Keep for 7 days if offline
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
                logging.getLogger(__name__).warning(f'Failed to send challenge FCM: {e}')

        return Response({
            'token': str(challenge.token),
            'message': f'Challenge notification sent to {success_count} device(s).',
        }, status=status.HTTP_201_CREATED)


class ClaimTriviaChallengeView(APIView):
    """
    POST /api/trivia/challenge/claim/
    { "token": "uuid-here" }
    Marks the challenge as used. Returns category + set_id so the app can start the game.
    Only the recipient can claim it. Can only be claimed once.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        token = request.data.get('token')
        if not token:
            return Response({'error': 'token is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            challenge = TriviaChallenge.objects.get(token=token)
        except (TriviaChallenge.DoesNotExist, Exception):
            return Response({'error': 'Challenge not found.'}, status=status.HTTP_404_NOT_FOUND)

        if challenge.is_expired:
            return Response({'error': 'This challenge link has expired.'}, status=status.HTTP_410_GONE)

        if challenge.is_used:
            return Response({'error': 'This challenge has already been played!'}, status=status.HTTP_409_CONFLICT)

        # Mark as used atomically
        challenge.is_used = True
        challenge.used_at = timezone.now()
        challenge.save(update_fields=['is_used', 'used_at'])

        challenger_name = (
            getattr(challenge.challenger, 'display_name', None)
            or challenge.challenger.first_name
            or str(challenge.challenger)
        )

        return Response({
            'category': challenge.category,
            'set_id': challenge.set_id,
            'challenger_name': challenger_name,
        }, status=status.HTTP_200_OK)
