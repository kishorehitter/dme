import requests
import yt_dlp
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

@method_decorator(csrf_exempt, name='dispatch')
class YouTubeSearchView(APIView):
    # ... (existing code remains)
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

@method_decorator(csrf_exempt, name='dispatch')
class YouTubeStreamView(APIView):
    """
    Industrial Standard Extraction: 
    Converts a Video ID into a direct, temporary audio stream URL.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        video_id = request.data.get('videoId')
        if not video_id:
            return Response({'error': 'Video ID is required'}, status=status.HTTP_400_BAD_REQUEST)

        ydl_opts = {
            'format': 'bestaudio/best',
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'force_generic_extractor': False,
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-Dest': 'document',
            },
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
                # Filter for audio-only streams if possible, otherwise take the best
                stream_url = info.get('url')
                
                return Response({
                    'url': stream_url,
                    'title': info.get('title'),
                    'thumbnail': info.get('thumbnail'),
                    'duration': info.get('duration'),
                })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
