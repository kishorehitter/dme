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

# ─── Piped instances — only keep reliably reachable ones ─────────────────────
# Removed: piped-api.garudalinux.org (DNS fails on Render)
#          pipedapi.in               (DNS fails on Render)
#          piped.adminforge.de/api   (DNS resolution broken on Render)
PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.projectsegfau.lt',
    'https://piped.video/api',
    'https://piped-api.privacy.com.de',
    'https://pipedapi.reallyaweso.me',
]

# ─── Invidious instances — open-source YouTube front-end, good fallback ──────
INVIDIOUS_INSTANCES = [
    'https://invidious.snopyta.org',
    'https://invidious.namazso.eu',
    'https://inv.tux.pizza',
    'https://invidious.privacydev.net',
    'https://yewtu.be',
]

# ─── yt-dlp player clients to try in order (most reliable first) ─────────────
# android_testsuite and tv_embedded bypass the bot-check on server IPs
YTDLP_PLAYER_CLIENTS = [
    ['android_testsuite'],
    ['tv_embedded'],
    ['android_vr'],
    ['mweb'],
]


@method_decorator(csrf_exempt, name='dispatch')
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


@method_decorator(csrf_exempt, name='dispatch')
class YouTubeStreamView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        video_id = request.data.get('videoId')
        if not video_id:
            return Response({'error': 'Video ID is required'}, status=status.HTTP_400_BAD_REQUEST)

        # ── Step 1: Try Piped instances ───────────────────────────────────────
        result = self._try_piped(video_id)
        if result:
            return Response(result)

        # ── Step 2: Try Invidious instances ──────────────────────────────────
        result = self._try_invidious(video_id)
        if result:
            return Response(result)

        # ── Step 3: yt-dlp with multiple player clients ───────────────────────
        return self._ytdlp_fallback(video_id)

    def _try_piped(self, video_id):
        """Try Piped API instances for audio stream URL."""
        for instance in PIPED_INSTANCES:
            try:
                response = requests.get(
                    f'{instance}/streams/{video_id}',
                    timeout=8,
                    headers={'User-Agent': 'Mozilla/5.0 (compatible)'}
                )
                if response.status_code != 200:
                    logger.warning(f'⚠️ Piped {instance} returned {response.status_code}')
                    continue

                data = response.json()
                audio_streams = data.get('audioStreams', [])
                if not audio_streams:
                    logger.warning(f'⚠️ Piped {instance} no audio streams for {video_id}')
                    continue

                # Pick highest-bitrate audio stream
                best_audio = sorted(
                    audio_streams,
                    key=lambda x: x.get('bitrate', 0),
                    reverse=True
                )[0]

                stream_url = best_audio.get('url')
                if not stream_url:
                    continue

                logger.info(f'✅ Piped {instance} success for {video_id}')
                return {
                    'url': stream_url,
                    'title': data.get('title'),
                    'thumbnail': data.get('thumbnailUrl'),
                    'duration': data.get('duration'),
                    'source': 'piped',
                }

            except Exception as e:
                logger.warning(f'⚠️ Piped {instance} stream failed: {e}')
                continue

        logger.warning(f'⚠️ All Piped instances failed for {video_id}')
        return None

    def _try_invidious(self, video_id):
        """Try Invidious instances for audio stream URL."""
        for instance in INVIDIOUS_INSTANCES:
            try:
                response = requests.get(
                    f'{instance}/api/v1/videos/{video_id}',
                    timeout=8,
                    headers={'User-Agent': 'Mozilla/5.0 (compatible)'}
                )
                if response.status_code != 200:
                    logger.warning(f'⚠️ Invidious {instance} returned {response.status_code}')
                    continue

                data = response.json()
                adaptive_formats = data.get('adaptiveFormats', [])

                # Filter audio-only streams
                audio_streams = [
                    f for f in adaptive_formats
                    if f.get('type', '').startswith('audio/')
                ]
                if not audio_streams:
                    logger.warning(f'⚠️ Invidious {instance} no audio streams for {video_id}')
                    continue

                # Pick highest-bitrate audio stream
                best_audio = sorted(
                    audio_streams,
                    key=lambda x: x.get('bitrate', 0),
                    reverse=True
                )[0]

                stream_url = best_audio.get('url')
                if not stream_url:
                    continue

                logger.info(f'✅ Invidious {instance} success for {video_id}')
                return {
                    'url': stream_url,
                    'title': data.get('title'),
                    'thumbnail': f'https://i.ytimg.com/vi/{video_id}/mqdefault.jpg',
                    'duration': data.get('lengthSeconds'),
                    'source': 'invidious',
                }

            except Exception as e:
                logger.warning(f'⚠️ Invidious {instance} stream failed: {e}')
                continue

        logger.warning(f'⚠️ All Invidious instances failed for {video_id}')
        return None

    def _ytdlp_fallback(self, video_id):
        """
        yt-dlp fallback — tries multiple player clients to bypass bot detection.
        android_testsuite and tv_embedded are most reliable on datacenter IPs.
        """
        url = f'https://www.youtube.com/watch?v={video_id}'

        for clients in YTDLP_PLAYER_CLIENTS:
            ydl_opts = {
                'format': 'bestaudio[ext=m4a]/bestaudio/best',
                'quiet': True,
                'no_warnings': True,
                'skip_download': True,
                'socket_timeout': 15,
                'extractor_args': {
                    'youtube': {
                        'player_client': clients,
                        'skip': ['hls', 'dash'],
                    }
                },
                'http_headers': {
                    'User-Agent': (
                        'Mozilla/5.0 (Linux; Android 11; Pixel 5) '
                        'AppleWebKit/537.36 (KHTML, like Gecko) '
                        'Chrome/120.0.0.0 Mobile Safari/537.36'
                    ),
                },
            }
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=False)

                stream_url = info.get('url')
                if not stream_url:
                    continue

                logger.info(f'✅ yt-dlp ({clients}) success for {video_id}')
                return Response({
                    'url': stream_url,
                    'title': info.get('title'),
                    'thumbnail': info.get('thumbnail'),
                    'duration': info.get('duration'),
                    'source': 'ytdlp',
                })
            except Exception as e:
                logger.warning(f'⚠️ yt-dlp client={clients} failed for {video_id}: {e}')
                continue

        logger.error(f'❌ All stream sources exhausted for {video_id}')
        return Response(
            {'error': 'Stream unavailable. All sources failed.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )


class YouTubeStreamProxyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        video_id = request.data.get('videoId')
        if not video_id:
            return Response({'error': 'Video ID required'}, status=400)

        for clients in YTDLP_PLAYER_CLIENTS:
            ydl_opts = {
                'format': 'bestaudio[ext=m4a]/bestaudio/best',
                'quiet': True,
                'skip_download': True,
                'socket_timeout': 15,
                'extractor_args': {
                    'youtube': {
                        'player_client': clients,
                        'skip': ['hls', 'dash'],
                    }
                },
            }
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(
                        f'https://www.youtube.com/watch?v={video_id}',
                        download=False
                    )
                    if info.get('url'):
                        return Response({
                            'url': info.get('url'),
                            'title': info.get('title'),
                            'thumbnail': info.get('thumbnail'),
                            'duration': info.get('duration'),
                        })
            except Exception as e:
                logger.warning(f'⚠️ ProxyView yt-dlp client={clients} failed: {e}')
                continue

        return Response({'error': 'Stream unavailable'}, status=503)