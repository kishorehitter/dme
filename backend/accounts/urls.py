"""
URLs for accounts app.
"""
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    GoogleLoginView,
    ProfileView,
    ProfileUpdateView,
    UsernameCheckView,
    ProfileSetupView,
    UserDetailView,
    LogoutView,
    UserBlockView,
    UserBlockStatusView,
    UserBlockedByStatusView,
)

urlpatterns = [
    # Authentication
    path('google/', GoogleLoginView.as_view(), name='google_login'),
    path('logout/', LogoutView.as_view(), name='logout'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # Profile
    path('profile/', ProfileView.as_view(), name='profile'),
    path('profile/update/', ProfileUpdateView.as_view(), name='profile_update'),
    path('profile/setup/', ProfileSetupView.as_view(), name='profile_setup'),
    path('username/check/', UsernameCheckView.as_view(), name='username_check'),
    path('users/<int:user_id>/', UserDetailView.as_view(), name='user_detail'),

    # User Block
    path('users/<int:user_id>/block/', UserBlockView.as_view(), name='user_block'),
    path('users/<int:user_id>/block-status/', UserBlockStatusView.as_view(), name='user_block_status'),
    path('users/<int:user_id>/blocked-by-status/', UserBlockedByStatusView.as_view(), name='user_blocked_by_status'),
]
