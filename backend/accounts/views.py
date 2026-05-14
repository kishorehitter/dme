"""
Views for accounts app - Authentication and user management.
"""
from rest_framework import status, generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.conf import settings
from django.utils import timezone
from datetime import timedelta

from .models import OTP, UserBlock
from .serializers import (
    UserSerializer,
    ProfileUpdateSerializer,
    UsernameCheckSerializer,
    ProfileSetupSerializer
)

User = get_user_model()



class GoogleLoginView(APIView):
    """
    Google OAuth login/signup.
    ...
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        # ... keep the existing GoogleLoginView logic ...
        try:
            id_token = request.data.get('id_token')
            if not id_token:
                return Response(
                    {'error': 'id_token is required'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Verify the Google ID token
            from google.oauth2 import id_token as google_id_token
            from google.auth.transport import requests

            # Your Web Client ID from Google Cloud Console
            CLIENT_ID = '336096929365-e3p49jq04cr8sbqqmlm64nh1qgsl0j51.apps.googleusercontent.com'

            decoded_token = google_id_token.verify_oauth2_token(
                id_token,
                requests.Request(),
                CLIENT_ID
            )

            # Extract user info from the decoded token
            email = decoded_token.get('email')
            google_sub = decoded_token.get('sub')
            display_name = decoded_token.get('name', '')
            picture = decoded_token.get('picture', '')

            if not email:
                return Response(
                    {'error': 'Email not found in Google token'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Get or create the user in Django
            try:
                user = User.objects.get(email=email)
                is_new_user = False
            except User.DoesNotExist:
                # Create new user with Google account
                # Temporary username until they set one in ProfileSetup
                temp_username = f"user_{google_sub[:10]}"
                user = User.objects.create_user(
                    email=email,
                )
                user.username = temp_username
                user.display_name = display_name or email.split('@')[0]
                user.is_profile_complete = False
                user.is_verified = True # Google email is verified
                user.save()
                is_new_user = True

            # Generate JWT tokens
            refresh = RefreshToken.for_user(user)

            # Update last_login
            user.last_login = timezone.now()
            user.save(update_fields=['last_login'])

            return Response({
                'message': 'Login successful',
                'access_token': str(refresh.access_token),
                'refresh_token': str(refresh),
                'user': UserSerializer(user).data,
                'is_new_user': is_new_user,
            }, status=status.HTTP_200_OK)

        except ValueError as e:
            # Google token verification failed
            return Response(
                {'error': f'Invalid Google token: {str(e)}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response(
                {'error': f'Google authentication failed: {str(e)}'},
                status=status.HTTP_400_BAD_REQUEST
            )


class ProfileView(generics.RetrieveUpdateAPIView):
    """
    Get and update current user profile.
    """
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context


class ProfileUpdateView(generics.UpdateAPIView):
    """
    Update user profile details.
    """
    serializer_class = ProfileUpdateSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context
        
    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        # Handle profile picture upload if present in multipart/form-data
        profile_picture = request.FILES.get('profile_picture')
        if profile_picture:
            serializer.save(profile_picture=profile_picture)
        else:
            serializer.save()

        return Response(UserSerializer(instance, context={'request': request}).data)


class UsernameCheckView(APIView):
    """
    Check if a username is available.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = UsernameCheckSerializer(data=request.data)
        if serializer.is_valid():
            return Response({'available': True}, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ProfileSetupView(generics.UpdateAPIView):
    """
    Initial profile setup for onboarding, including profile picture upload.
    """
    serializer_class = ProfileSetupSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        if not serializer.is_valid():
            print(f"DEBUG: Serializer errors: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        # Handle profile picture upload
        profile_picture = request.FILES.get('profile_picture')
        if profile_picture:
            serializer.save(profile_picture=profile_picture) # Pass file directly
        else:
            serializer.save()

        # Update is_profile_complete and last_username_change is handled in serializer.update
        return Response(UserSerializer(instance, context={'request': request}).data)


class UserDetailView(generics.RetrieveAPIView):
    """
    Get public profile of a specific user.
    """
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = 'id'
    lookup_url_kwarg = 'user_id'


class LogoutView(APIView):
    """
    Logout user by blacklisting refresh token.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        try:
            refresh_token = request.data.get('refresh_token')
            token = RefreshToken(refresh_token)
            token.blacklist()
            return Response({'message': 'Logout successful'}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': 'Invalid token'}, status=status.HTTP_400_BAD_REQUEST)


class UserBlockView(APIView):
    """
    Block or unblock a user.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, user_id):
        try:
            blocked_user = User.objects.get(id=user_id)
            
            # Can't block yourself
            if blocked_user.id == request.user.id:
                return Response(
                    {'error': 'You cannot block yourself'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Check if already blocked
            existing_block = UserBlock.objects.filter(
                blocker=request.user,
                blocked=blocked_user
            ).first()
            
            blocked = request.data.get('blocked', True)
            
            if blocked:
                # Block the user
                if not existing_block:
                    UserBlock.objects.create(blocker=request.user, blocked=blocked_user)
                return Response(
                    {'message': f'Blocked {blocked_user.email}', 'blocked': True},
                    status=status.HTTP_200_OK
                )
            else:
                # Unblock the user
                if existing_block:
                    existing_block.delete()
                return Response(
                    {'message': f'Unblocked {blocked_user.email}', 'blocked': False},
                    status=status.HTTP_200_OK
                )
        except User.DoesNotExist:
            return Response(
                {'error': 'User not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )


class UserBlockStatusView(APIView):
    """
    Check if a user is blocked by the current user.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, user_id):
        try:
            is_blocked = UserBlock.objects.filter(
                blocker=request.user,
                blocked_id=user_id
            ).exists()
            
            return Response({'blocked': is_blocked}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )


class UserBlockedByStatusView(APIView):
    """
    Check if the current user is blocked by another user.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, user_id):
        try:
            blocked_by = UserBlock.objects.filter(
                blocker_id=user_id,
                blocked=request.user
            ).exists()
            
            return Response({'blocked_by': blocked_by}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
