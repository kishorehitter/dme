from django.urls import path
from .views import (
    UploadKeyBundleView,
    FetchPreKeyBundleView,
    ReplenishPreKeysView,
    KeyStatusView
)

urlpatterns = [
    path('keys/upload/', UploadKeyBundleView.as_view(), name='key-upload'),
    path('keys/<int:user_id>/bundle/', FetchPreKeyBundleView.as_view(), name='key-fetch-bundle'),
    path('keys/replenish/', ReplenishPreKeysView.as_view(), name='key-replenish'),
    path('keys/status/', KeyStatusView.as_view(), name='key-status'),
]
