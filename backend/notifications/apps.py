from django.apps import AppConfig
import firebase_admin
from firebase_admin import credentials
from django.conf import settings
import os


class NotificationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'notifications'

    def ready(self):
        # Initialize Firebase Admin SDK
        firebase_config = getattr(settings, 'FIREBASE_CONFIG', None)
        firebase_cert_path = getattr(settings, 'FIREBASE_CREDENTIALS_PATH', None)

        if firebase_cert_path and os.path.exists(firebase_cert_path):
            try:
                cred = credentials.Certificate(firebase_cert_path)
                firebase_admin.initialize_app(cred)
            except ValueError:
                # App already initialized
                pass
        elif firebase_config:
            try:
                cred = credentials.Certificate(firebase_config)
                firebase_admin.initialize_app(cred)
            except ValueError:
                # App already initialized
                pass
        else:
            print("Warning: Firebase credentials not configured. FCM notifications will not work.")
