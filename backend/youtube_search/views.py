import requests
import yt_dlp
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

import logging
logger = logging.getLogger(__name__)

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

PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://piped-api.garudalinux.org',
    'https://api.piped.projectsegfau.lt',
    'https://pipedapi.in',
    'https://piped.adminforge.de/api',
]

@method_decorator(csrf_exempt, name='dispatch')
class YouTubeStreamView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        video_id = request.data.get('videoId')
        if not video_id:
            return Response({'error': 'Video ID is required'}, status=status.HTTP_400_BAD_REQUEST)

        # Try each Piped instance
        for instance in PIPED_INSTANCES:
            try:
                response = requests.get(
                    f'{instance}/streams/{video_id}',
                    timeout=8,
                    headers={'User-Agent': 'Mozilla/5.0'}
                )
                if response.status_code != 200:
                    continue

                data = response.json()

                # Get best audio stream
                audio_streams = data.get('audioStreams', [])
                if not audio_streams:
                    continue

                # Sort by bitrate, pick highest
                best_audio = sorted(
                    audio_streams,
                    key=lambda x: x.get('bitrate', 0),
                    reverse=True
                )[0]

                stream_url = best_audio.get('url')
                if not stream_url:
                    continue

                return Response({
                    'url': stream_url,
                    'title': data.get('title'),
                    'thumbnail': data.get('thumbnailUrl'),
                    'duration': data.get('duration'),
                })

            except Exception as e:
                logger.warning(f'⚠️ Piped {instance} stream failed: {e}')
                continue

        # Final fallback — yt-dlp with PO token workaround
        return self._ytdlp_fallback(video_id)

    def _ytdlp_fallback(self, video_id):
        ydl_opts = {
            'format': 'bestaudio/best',
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'extractor_args': {
                'youtube': {
                    'player_client': ['android'],  # ← android client avoids bot check
                }
            },
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(
                    f'https://www.youtube.com/watch?v={video_id}',
                    download=False
                )
                return Response({
                    'url': info.get('url'),
                    'title': info.get('title'),
                    'thumbnail': info.get('thumbnail'),
                    'duration': info.get('duration'),
                })
        except Exception as e:
            logger.error(f'❌ yt-dlp fallback failed: {e}')
            return Response(
                {'error': 'Stream unavailable'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )


class YouTubeStreamProxyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        video_id = request.data.get('videoId')
        if not video_id:
            return Response({'error': 'Video ID required'}, status=400)

        # Get stream URL via yt-dlp
        ydl_opts = {
            'format': 'bestaudio/best',
            'quiet': True,
            'skip_download': True,
            'extractor_args': {
                'youtube': {'player_client': ['android']}
            },
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(
                    f'https://www.youtube.com/watch?v={video_id}',
                    download=False
                )
                return Response({
                    'url': info.get('url'),
                    'title': info.get('title'),
                    'thumbnail': info.get('thumbnail'),
                    'duration': info.get('duration'),
                })
        except Exception as e:
            return Response({'error': str(e)}, status=503)