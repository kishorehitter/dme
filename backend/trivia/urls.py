from django.urls import path
from .views import CreateTriviaChallengeView, ClaimTriviaChallengeView, ConvertQuizPdfView

urlpatterns = [
    path('challenge/create/', CreateTriviaChallengeView.as_view(), name='trivia-challenge-create'),
    path('challenge/claim/', ClaimTriviaChallengeView.as_view(), name='trivia-challenge-claim'),
    path('convert-quiz/', ConvertQuizPdfView.as_view(), name='trivia-convert-quiz'),
]
