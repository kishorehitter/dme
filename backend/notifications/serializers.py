from rest_framework import serializers
from accounts.models import FCMDevice


class FCMDeviceSerializer(serializers.ModelSerializer):
    """Serializer for FCMDevice model."""

    class Meta:
        model = FCMDevice
        fields = ['id', 'device_id', 'registration_token', 'platform', 'is_active', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def create(self, validated_data):
        user = self.context['request'].user
        device_id = validated_data['device_id']
        registration_token = validated_data['registration_token']

        # 1. Deactivate other devices with the SAME registration_token (cleanup duplicates)
        # This prevents sending multiple notifications to the same device if it re-registered with a new device_id
        FCMDevice.objects.filter(
            registration_token=registration_token
        ).exclude(
            user=user, 
            device_id=device_id
        ).update(is_active=False)

        # 2. Update or create the current device
        device, created = FCMDevice.objects.update_or_create(
            user=user,
            device_id=device_id,
            defaults={
                'registration_token': registration_token,
                'platform': validated_data['platform'],
                'is_active': True,
            }
        )
        return device
