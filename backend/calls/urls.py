"""
URLs for calls app.
"""
from django.urls import path
from .views import (
    CallAcceptView,
    CallInitiateView,
    CallEndView,
    CallRejectView,
    CallHistoryView,
    GroupCallInitiateView,
    InviteToCallView,
    JoinGroupCallView,
    LiveKitTokenView,
)

urlpatterns = [
    # Call management
    path('initiate/', CallInitiateView.as_view(), name='call_initiate'),
    path('end/', CallEndView.as_view(), name='call_end'),
    path('reject/', CallRejectView.as_view(), name='call_reject'),
    path('history/', CallHistoryView.as_view(), name='call_history'),
    path('accept/', CallAcceptView.as_view(), name='call-accept'),

    # Group Call management
    path('group/initiate/', GroupCallInitiateView.as_view(), name='group_call_initiate'),
    path('group/invite/', InviteToCallView.as_view(), name='group_call_invite'),
    path('group/<int:call_id>/join/', JoinGroupCallView.as_view(), name='group_call_join'),
    path('livekit/token/', LiveKitTokenView.as_view(), name='livekit-token'),
]
