from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from django.contrib.auth import get_user_model
from django.db import transaction
from .models import IdentityKey, SignedPreKey, OneTimePreKey
from .serializers import (
    KeyBundleUploadSerializer,
    OneTimePreKeySerializer,
    PreKeyBundleResponseSerializer
)

User = get_user_model()

class UploadKeyBundleView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        serializer = KeyBundleUploadSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        data = serializer.validated_data

        # Clear existing keys if re-uploading bundle for user
        IdentityKey.objects.filter(user=user).delete()
        SignedPreKey.objects.filter(user=user).delete()
        OneTimePreKey.objects.filter(user=user).delete()

        # Create Identity Key
        IdentityKey.objects.create(
            user=user,
            public_key=data['identity_key']['public_key']
        )

        # Create Signed PreKey
        SignedPreKey.objects.create(
            user=user,
            key_id=data['signed_prekey']['key_id'],
            public_key=data['signed_prekey']['public_key'],
            signature=data['signed_prekey']['signature']
        )

        # Create One-Time PreKeys
        one_time_prekeys_data = data.get('one_time_prekeys', [])
        otpk_instances = [
            OneTimePreKey(
                user=user,
                key_id=otpk['key_id'],
                public_key=otpk['public_key']
            )
            for otpk in one_time_prekeys_data
        ]
        if otpk_instances:
            OneTimePreKey.objects.bulk_create(otpk_instances, ignore_conflicts=True)

        remaining_count = OneTimePreKey.objects.filter(user=user).count()
        return Response({
            "message": "Key bundle uploaded successfully.",
            "one_time_prekeys_remaining": remaining_count
        }, status=status.HTTP_201_CREATED)


class FetchPreKeyBundleView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def get(self, request, user_id):
        try:
            target_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({"error": "User not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            identity_key = target_user.identity_key
        except IdentityKey.DoesNotExist:
            return Response({"error": "User has not uploaded keys."}, status=status.HTTP_404_NOT_FOUND)

        signed_prekey = target_user.signed_prekeys.first()
        if not signed_prekey:
            return Response({"error": "User has no signed prekey."}, status=status.HTTP_404_NOT_FOUND)

        # Try to get and consume a one-time prekey
        one_time_prekey = target_user.one_time_prekeys.first()
        otpk_data = None
        if one_time_prekey:
            otpk_data = {
                'key_id': one_time_prekey.key_id,
                'public_key': one_time_prekey.public_key
            }
            one_time_prekey.delete()

        response_data = {
            'identity_key': identity_key.public_key,
            'signed_prekey': {
                'key_id': signed_prekey.key_id,
                'public_key': signed_prekey.public_key,
                'signature': signed_prekey.signature
            },
            'one_time_prekey': otpk_data
        }

        return Response(response_data, status=status.HTTP_200_OK)


class ReplenishPreKeysView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        serializer = OneTimePreKeySerializer(data=request.data, many=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        otpk_instances = [
            OneTimePreKey(
                user=user,
                key_id=otpk['key_id'],
                public_key=otpk['public_key']
            )
            for otpk in serializer.validated_data
        ]
        if otpk_instances:
            OneTimePreKey.objects.bulk_create(otpk_instances, ignore_conflicts=True)

        total_count = OneTimePreKey.objects.filter(user=user).count()
        return Response({
            "message": "One-time prekeys replenished successfully.",
            "total_prekeys_available": total_count
        }, status=status.HTTP_200_OK)


class KeyStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        has_identity_key = hasattr(user, 'identity_key')
        has_signed_prekey = user.signed_prekeys.exists()
        otpk_count = user.one_time_prekeys.count()

        return Response({
            "has_identity_key": has_identity_key,
            "has_signed_prekey": has_signed_prekey,
            "one_time_prekeys_remaining": otpk_count
        }, status=status.HTTP_200_OK)
