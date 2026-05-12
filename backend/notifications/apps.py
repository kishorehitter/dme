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
        import json
        import os
        from firebase_admin import credentials
        import firebase_admin

        firebase_json = os.environ.get('FIREBASE_CREDENTIALS')

        if firebase_json:
            try:
                cred_dict = json.loads(firebase_json)
                cred = credentials.Certificate(cred_dict)
                firebase_admin.initialize_app(cred)
                print("Firebase Admin SDK initialized successfully.")
            except Exception as e:
                print(f"Warning: Failed to initialize Firebase: {e}")
        else:
            print("Warning: FIREBASE_CREDENTIALS not configured in environment variables.")
