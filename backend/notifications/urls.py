"""
URL Configuration for notifications app.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    FCMDeviceViewSet,
    FCMDeviceRegisterView,
    FCMDeviceListView,
    FCMDeviceRemoveView,
    FCMTestNotificationView,
)

router = DefaultRouter()
router.register(r'devices', FCMDeviceViewSet, basename='fcm-device')

urlpatterns = [
    path('', include(router.urls)),
    path('register/', FCMDeviceRegisterView.as_view(), name='fcm-register'),
    path('list/', FCMDeviceListView.as_view(), name='fcm-list'),
    path('remove/', FCMDeviceRemoveView.as_view(), name='fcm-remove'),
    path('test/', FCMTestNotificationView.as_view(), name='fcm-test'),
]
