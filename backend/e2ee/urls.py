from django.urls import path
from .views import (
    UploadKeyBundleView,
    FetchPreKeyBundleView,
    ReplenishPreKeysView,
    KeyStatusView,
    BackupStatusView,
    BackupUploadView,
    BackupDownloadView,
    BackupResetView
)

urlpatterns = [
    path('keys/upload/', UploadKeyBundleView.as_view(), name='key-upload'),
    path('keys/<int:user_id>/bundle/', FetchPreKeyBundleView.as_view(), name='key-fetch-bundle'),
    path('keys/replenish/', ReplenishPreKeysView.as_view(), name='key-replenish'),
    path('keys/status/', KeyStatusView.as_view(), name='key-status'),
    path('backup/status/', BackupStatusView.as_view(), name='backup-status'),
    path('backup/upload/', BackupUploadView.as_view(), name='backup-upload'),
    path('backup/download/', BackupDownloadView.as_view(), name='backup-download'),
    path('backup/reset/', BackupResetView.as_view(), name='backup-reset'),
]
