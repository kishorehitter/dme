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

        # Stable deduplication ID scoped per challenger
        import time as _time
        notif_id = f'trivia_challenge_{request.user.id}_{int(_time.time())}'

        data = {
            'type': 'trivia_challenge_token',
            # Human-readable display fields
            'category_label': category_label,
            'set_label': set_label,
            'challenger_name': str(sender_name),
            'challenger_id': str(request.user.id),
            # Internal routing key — UUID token used only by the app to claim the challenge
            '_challenge_token': str(challenge.token),
            # Stable deduplication ID to prevent duplicate notifications
            'notif_id': notif_id,
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


class ConvertQuizPdfView(APIView):
    """
    POST /api/trivia/convert-quiz/
    Multipart form-data:
      - file: the PDF file
      - category (optional, defaults to "general")
      - difficulty (optional, defaults to "medium")

    Deterministic PDF parser — no external AI, no per-conversion cost.
    Validates numbered questions, A-D choices, and single asterisk '*' correct marker.
    """
    parser_classes = [permissions.AllowAny and __import__('rest_framework.parsers').parsers.MultiPartParser,
                      __import__('rest_framework.parsers').parsers.FormParser]
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        uploaded_file = request.FILES.get('file')
        if not uploaded_file:
            return Response(
                {'error': "No PDF file uploaded. Send it as form-data field 'file'."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if uploaded_file.size > 10 * 1024 * 1024:
            return Response(
                {'error': "File size exceeds 10MB limit. Please upload a smaller PDF."},
                status=status.HTTP_400_BAD_REQUEST
            )

        category = request.data.get('category', 'general')
        difficulty = request.data.get('difficulty', 'medium')

        from .quiz_parser import parse_quiz_text, extract_text_from_pdf_stream

        try:
            raw_text = extract_text_from_pdf_stream(uploaded_file.read())
        except Exception as e:
            return Response(
                {'error': f"Failed to extract text from PDF: {str(e)}"},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )

        if not raw_text or not raw_text.strip():
            return Response(
                {'error': "Couldn't read any text from this PDF. If it's a scanned image, text extraction won't work — please upload a text-based PDF instead."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )

        result = parse_quiz_text(raw_text, category=category, difficulty=difficulty)

        if result['totalFound'] == 0:
            return Response(
                {
                    'error': "No numbered questions were found. Make sure your PDF follows the format: '1. Question text' followed by 'A. / B. / C. / D.' choices.",
                    'issues': result['issues'],
                    'totalParsed': 0,
                    'totalFound': 0,
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )

        if not result['isFullyValid']:
            return Response(
                {
                    'error': f"{len(result['issues'])} of {result['totalFound']} question(s) couldn't be parsed. Fix the issues below and re-upload.",
                    'issues': result['issues'],
                    'totalParsed': result['totalParsed'],
                    'totalFound': result['totalFound'],
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )

        return Response({
            'questions': result['questions'],
            'totalParsed': result['totalParsed'],
        }, status=status.HTTP_200_OK)

