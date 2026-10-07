from django.db import models
from django.conf import settings

class IdentityKey(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='identity_key')
    public_key = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = 'e2ee'

    def __str__(self):
        return f"Identity Key for {self.user}"

class SignedPreKey(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='signed_prekeys')
    key_id = models.IntegerField()
    public_key = models.TextField()
    signature = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = 'e2ee'
        unique_together = ['user', 'key_id']
        ordering = ['-created_at']

    def __str__(self):
        return f"Signed PreKey {self.key_id} for {self.user}"

class OneTimePreKey(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='one_time_prekeys')
    key_id = models.IntegerField()
    public_key = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = 'e2ee'
        unique_together = ['user', 'key_id']

    def __str__(self):
        return f"One-Time PreKey {self.key_id} for {self.user}"
