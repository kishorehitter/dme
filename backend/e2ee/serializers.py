from rest_framework import serializers
from .models import IdentityKey, SignedPreKey, OneTimePreKey

class IdentityKeySerializer(serializers.ModelSerializer):
    class Meta:
        model = IdentityKey
        fields = ['public_key']

class SignedPreKeySerializer(serializers.ModelSerializer):
    class Meta:
        model = SignedPreKey
        fields = ['key_id', 'public_key', 'signature']

class OneTimePreKeySerializer(serializers.ModelSerializer):
    class Meta:
        model = OneTimePreKey
        fields = ['key_id', 'public_key']

class KeyBundleUploadSerializer(serializers.Serializer):
    identity_key = IdentityKeySerializer()
    signed_prekey = SignedPreKeySerializer()
    one_time_prekeys = OneTimePreKeySerializer(many=True, required=False)

    def validate(self, data):
        return data

class PreKeyBundleResponseSerializer(serializers.Serializer):
    identity_key = serializers.CharField()
    signed_prekey = SignedPreKeySerializer()
    one_time_prekey = OneTimePreKeySerializer(allow_null=True)
