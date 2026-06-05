import requests
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

class YouTubeSearchView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        query = request.data.get('query')
        max_results = request.data.get('maxResults', 15)

        if not query:
            return Response({'error': 'Query is required'}, status=status.HTTP_400_BAD_REQUEST)

        api_key = getattr(settings, 'YOUTUBE_API_KEY', None)
        if not api_key:
            return Response({'error': 'YouTube API key not configured'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        url = "https://www.googleapis.com/youtube/v3/search"
        params = {
            'part': 'snippet',
            'q': query,
            'maxResults': max_results,
            'type': 'video',
            'key': api_key
        }

        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            return Response(response.json())
        except requests.exceptions.RequestException as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
