from django.urls import path
from .views import CreateTriviaChallengeView, ClaimTriviaChallengeView

urlpatterns = [
    path('challenge/create/', CreateTriviaChallengeView.as_view(), name='trivia-challenge-create'),
    path('challenge/claim/', ClaimTriviaChallengeView.as_view(), name='trivia-challenge-claim'),
]
