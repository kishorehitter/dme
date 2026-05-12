from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from .models import Status, StatusView
from .serializers import StatusSerializer, StatusViewSerializer
from django.utils import timezone
from datetime import timedelta

from django.db import models


class StatusViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = StatusSerializer

    def get_queryset(self):
        cutoff = timezone.now() - timedelta(hours=12)
        Status.objects.filter(created_at__lt=cutoff).delete()
        return (
            Status.objects
            .filter(created_at__gte=cutoff)
            .select_related('user')
            .prefetch_related('views__viewer', 'likes__user')
            .order_by('-created_at')
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.user != request.user:
            raise PermissionDenied("You can only delete your own statuses.")
        self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='view')
    def mark_viewed(self, request, pk=None):
        status_obj = self.get_object()
        if status_obj.user == request.user:
            return Response({'detail': 'Owner view not recorded.'})
        StatusView.objects.get_or_create(
            status=status_obj,
            viewer=request.user,
            defaults={'viewed_at': timezone.now()},
        )
        return Response({'detail': 'Viewed.'})

    @action(detail=True, methods=['get'], url_path='viewers')
    def viewers(self, request, pk=None):
        from .models import StatusLike
        status_obj = self.get_object()
        if status_obj.user != request.user:
            raise PermissionDenied("Only the owner can see viewers.")
        
        views = status_obj.views.select_related('viewer').order_by('-viewed_at')
        likes = StatusLike.objects.filter(status=status_obj).select_related('user')
        
        # Build liked user IDs set for quick lookup
        liked_user_ids = set(likes.values_list('user_id', flat=True))
        
        viewers_data = StatusViewSerializer(
            views, many=True, context={'request': request}
        ).data
        
        # Add has_liked flag to each viewer
        for viewer in viewers_data:
            viewer['has_liked'] = viewer['viewer_id'] in liked_user_ids
        
        return Response({
            'viewers': viewers_data,
            'like_count': likes.count(),
            'liked_users': [
                {
                    'user_id': like.user.id,
                    'username': like.user.username,
                    'avatar': request.build_absolute_uri(like.user.profile_picture.url)
                            if like.user.profile_picture else None,
                    'liked_at': like.created_at,
                }
                for like in likes
            ],
        })

    @action(detail=True, methods=['post', 'delete'], url_path='like')
    def like(self, request, pk=None):
        from .models import StatusLike
        status_obj = self.get_object()
        if request.method == 'POST':
            StatusLike.objects.get_or_create(status=status_obj, user=request.user)
            return Response({'detail': 'Liked.'}, status=status.HTTP_200_OK)
        else:
            StatusLike.objects.filter(status=status_obj, user=request.user).delete()
            return Response({'detail': 'Unliked.'}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['get'], url_path='liked')
    def liked(self, request, pk=None):
        from .models import StatusLike
        status_obj = self.get_object()
        has_liked = StatusLike.objects.filter(
            status=status_obj, user=request.user
        ).exists()
        return Response({'liked': has_liked})

    @action(detail=True, methods=['get'], url_path='like-count')
    def like_count(self, request, pk=None):
        from .models import StatusLike
        status_obj = self.get_object()
        count = StatusLike.objects.filter(status=status_obj).count()
        return Response({'count': count})

    @action(detail=True, methods=['post'], url_path='reply')
    def reply(self, request, pk=None):
        from .models import Conversation, ConversationParticipant, Message
        status_obj = self.get_object()
        message_text = request.data.get('message', '').strip()
        if not message_text:
            return Response(
                {'detail': 'Message is required.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        owner = status_obj.user
        sender = request.user
        if owner == sender:
            return Response(
                {'detail': 'Cannot reply to your own status.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        # Find or create DM conversation
        existing = Conversation.objects.filter(
            is_group=False,
            participants__user=sender
        ).filter(
            participants__user=owner
        ).first()

        if existing:
            conversation = existing
        else:
            conversation = Conversation.objects.create(
                is_group=False,
                created_by=sender
            )
            ConversationParticipant.objects.create(
                conversation=conversation, user=sender
            )
            ConversationParticipant.objects.create(
                conversation=conversation, user=owner
            )

        # Send message
        Message.objects.create(
            conversation=conversation,
            sender=sender,
            content=f'↩ Replied to status: {message_text}',
            message_type='text',
        )
        conversation.save()
        return Response({'detail': 'Reply sent.'}, status=status.HTTP_200_OK)