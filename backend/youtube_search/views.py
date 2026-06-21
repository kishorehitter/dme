"""
youtube_search/views.py — Production-hardened YouTube stream extraction
=======================================================================

ROOT CAUSE (Render/cloud datacenter):
  YouTube blocks all requests from known datacenter IPs unless they come
  with valid browser cookies + Proof-of-Origin (PO) token.

SOLUTION LAYERS (tried in order):
  1. Cookie-authenticated yt-dlp  ← needs YOUTUBE_COOKIES_B64 env var set
  2. Chrome-impersonating yt-dlp  ← works on newer yt-dlp builds
  3. Multiple alternative player clients with cookies
  4. Piped public instances        ← best-effort, many are unreliable
  5. Invidious public instances    ← best-effort
  6. Hard 503 with clear message

HOW TO SET UP THE COOKIE (do this once):
  a) Open Chrome/Firefox, go to youtube.com, sign into a throwaway Google
     account (NEVER your personal account — it may get flagged).
  b) Install the "Get cookies.txt LOCALLY" Chrome extension.
  c) Visit youtube.com and export cookies in Netscape format → cookies.txt
  d) Base64-encode it:
       Windows: certutil -encode cookies.txt cookies_b64.txt
       Linux:   base64 -w 0 cookies.txt
  e) Copy the single-line base64 string.
  f) In Render → Environment → add:
       YOUTUBE_COOKIES_B64 = <your base64 string>
  g) Redeploy. Stream extraction will now work from Render's IPs.

NOTE: Re-export cookies every ~2 weeks or when stream errors return.
"""

import os
import base64
import tempfile
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

# ─── Cookie file — written once at module load from the env var ───────────────
_COOKIE_FILE: str | None = None

def _get_cookie_file() -> str | None:
    """
    Lazily decode the base64 YouTube cookies env var into a temp file.
    Returns the file path, or None if the env var is not set.
    """
    global _COOKIE_FILE

    if _COOKIE_FILE and os.path.exists(_COOKIE_FILE):
        return _COOKIE_FILE

    b64 = os.environ.get('YOUTUBE_COOKIES_B64', '').strip()
    if not b64:
        logger.warning(
            '⚠️  YOUTUBE_COOKIES_B64 not set — yt-dlp will run WITHOUT cookies '
            '(stream extraction WILL fail on Render datacenter IPs). '
            'See the module docstring for setup instructions.'
        )
        return None

    try:
        cookie_bytes = base64.b64decode(b64)
        # Write to a temp file that persists for the process lifetime
        # Omit prefix='/tmp/' to be cross-platform (works on Windows & Linux)
        tmp = tempfile.NamedTemporaryFile(
            mode='wb',
            suffix='_yt_cookies.txt',
            delete=False
        )
        tmp.write(cookie_bytes)
        tmp.flush()
        tmp.close()
        _COOKIE_FILE = tmp.name
        logger.info(f'✅ YouTube cookies written to {_COOKIE_FILE}')
        return _COOKIE_FILE
    except Exception as e:
        logger.error(f'❌ Failed to decode YOUTUBE_COOKIES_B64: {e}')
        return None


def get_youtube_cookie_file() -> str | None:
    """
    Public accessor for decoded YouTube cookies temp file.
    """
    return _get_cookie_file()


# ─── Piped instances (public — may change; only fast/reliable ones) ───────────
PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.projectsegfau.lt',
    'https://piped.video/api',
    'https://pipedapi.reallyaweso.me',
    'https://pipedapi.darkness.services',
]

# ─── Invidious instances (public — check status.invidious.io for live list) ───
INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.io.lol',
    'https://invidious.privacydev.net',
    'https://iv.ggtyler.dev',
    'https://yewtu.be',
]

# ─── yt-dlp extraction strategies — tried in order ───────────────────────────
# Each entry: (label, extra_opts_override)
def _build_ytdlp_strategies(cookie_file: str | None) -> list:
    """
    Returns a list of (label, ydl_opts) tuples to try in order.
    Cookie-based strategies are prepended when a cookie file is available.
    """
    base = {
        'format': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'socket_timeout': 20,
        'http_headers': {
            'User-Agent': (
                'Mozilla/5.0 (Linux; Android 13; Pixel 7) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/124.0.0.0 Mobile Safari/537.36'
            ),
        },
    }

    strategies = []

    # ── Cookie + impersonation (most reliable on blocked IPs) ─────────────────
    if cookie_file:
        # 1. Standard web client with cookies (does NOT require impersonation dependencies)
        strategies.append((
            'cookies+web',
            {
                **base,
                'cookiefile': cookie_file,
                'extractor_args': {
                    'youtube': {'player_client': ['web']},
                },
            }
        ))
        # 2. Mobile web client with cookies (does NOT require impersonation dependencies)
        strategies.append((
            'cookies+mweb',
            {
                **base,
                'cookiefile': cookie_file,
                'extractor_args': {
                    'youtube': {'player_client': ['mweb']},
                },
            }
        ))
        # 3. Web client with cookies + chrome impersonation
        strategies.append((
            'cookies+impersonate_chrome',
            {
                **base,
                'cookiefile': cookie_file,
                'impersonate': 'chrome',  # yt-dlp >= 2024.09 supports this
                'extractor_args': {
                    'youtube': {'player_client': ['web']},
                },
            }
        ))
        # 4. Android testsuite client with cookies
        strategies.append((
            'cookies+android_testsuite',
            {
                **base,
                'cookiefile': cookie_file,
                'extractor_args': {
                    'youtube': {
                        'player_client': ['android_testsuite'],
                        'skip': ['dash'],
                    },
                },
            }
        ))
        # 5. iOS client with cookies
        strategies.append((
            'cookies+ios',
            {
                **base,
                'cookiefile': cookie_file,
                'extractor_args': {
                    'youtube': {
                        'player_client': ['ios'],
                    },
                },
            }
        ))
        # 6. TV Embedded client with cookies
        strategies.append((
            'cookies+tv_embedded',
            {
                **base,
                'cookiefile': cookie_file,
                'extractor_args': {
                    'youtube': {
                        'player_client': ['tv_embedded'],
                    },
                },
            }
        ))

    # ── Cookie-less attempts (rarely work on Render, but worth trying) ─────────
    for client in ['android_testsuite', 'tv_embedded', 'ios', 'android_vr', 'mweb', 'web_creator']:
        opts = {
            **base,
            'extractor_args': {
                'youtube': {
                    'player_client': [client],
                    'skip': ['dash'],
                },
            },
        }
        if cookie_file:
            opts['cookiefile'] = cookie_file  # always pass cookies if available
        strategies.append((f'client={client}', opts))

    return strategies



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
            return Response(
                {'error': 'YouTube API key not configured'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        url = "https://www.googleapis.com/youtube/v3/search"
        params = {
            'part': 'snippet',
            'q': query,
            'maxResults': max_results,
            'type': 'video',
            'key': api_key
        }

        try:
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            return Response(response.json())
        except requests.exceptions.RequestException as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@method_decorator(csrf_exempt, name='dispatch')
class YouTubeStreamView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        video_id = request.data.get('videoId', '').strip()
        if not video_id:
            return Response({'error': 'Video ID is required'}, status=status.HTTP_400_BAD_REQUEST)

        logger.info(f'🎵 Stream request for video_id={video_id}')

        # ── Step 1: yt-dlp with cookie auth (primary & most reliable) ─────────
        cookie_file = _get_cookie_file()
        strategies = _build_ytdlp_strategies(cookie_file)

        for label, ydl_opts in strategies:
            result = self._try_ytdlp(video_id, label, ydl_opts)
            if result:
                return Response(result)

        # ── Step 2: Piped (public instances — best-effort) ────────────────────
        result = self._try_piped(video_id)
        if result:
            return Response(result)

        # ── Step 3: Invidious (public instances — best-effort) ────────────────
        result = self._try_invidious(video_id)
        if result:
            return Response(result)

        # ── All sources exhausted ─────────────────────────────────────────────
        logger.error(f'❌ All stream sources exhausted for {video_id}')
        if not cookie_file:
            msg = (
                'Stream unavailable: server IP is blocked by YouTube. '
                'Set YOUTUBE_COOKIES_B64 environment variable in Render to fix this. '
                'See backend/youtube_search/views.py module docstring for instructions.'
            )
        else:
            msg = 'Stream temporarily unavailable. YouTube may have refreshed its cookies — re-export and update YOUTUBE_COOKIES_B64.'
        return Response({'error': msg}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    # ── yt-dlp helper ─────────────────────────────────────────────────────────
    def _try_ytdlp(self, video_id: str, label: str, ydl_opts: dict) -> dict | None:
        url = f'https://www.youtube.com/watch?v={video_id}'
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)

            stream_url = info.get('url')
            if not stream_url:
                # Some formats nest url inside 'requested_formats'
                for fmt in info.get('requested_formats', []):
                    if fmt.get('url'):
                        stream_url = fmt['url']
                        break

            if not stream_url:
                logger.warning(f'⚠️ yt-dlp [{label}] no URL in response for {video_id}')
                return None

            logger.info(f'✅ yt-dlp [{label}] success for {video_id}')
            return {
                'url': stream_url,
                'title': info.get('title'),
                'thumbnail': info.get('thumbnail') or f'https://i.ytimg.com/vi/{video_id}/mqdefault.jpg',
                'duration': info.get('duration'),
                'source': f'ytdlp:{label}',
            }
        except Exception as e:
            err = str(e)
            if 'Sign in' in err or 'bot' in err.lower():
                logger.warning(f'⚠️ yt-dlp [{label}] bot-blocked for {video_id}')
            else:
                logger.warning(f'⚠️ yt-dlp [{label}] failed for {video_id}: {err[:200]}')
            return None

    # ── Piped helper ──────────────────────────────────────────────────────────
    def _try_piped(self, video_id: str) -> dict | None:
        for instance in PIPED_INSTANCES:
            try:
                response = requests.get(
                    f'{instance}/streams/{video_id}',
                    timeout=7,
                    headers={'User-Agent': 'Mozilla/5.0 (compatible)'}
                )
                if response.status_code != 200:
                    logger.warning(f'⚠️ Piped {instance} returned {response.status_code}')
                    continue

                data = response.json()
                audio_streams = data.get('audioStreams', [])
                if not audio_streams:
                    continue

                best = sorted(audio_streams, key=lambda x: x.get('bitrate', 0), reverse=True)[0]
                stream_url = best.get('url')
                if not stream_url:
                    continue

                logger.info(f'✅ Piped {instance} success for {video_id}')
                return {
                    'url': stream_url,
                    'title': data.get('title'),
                    'thumbnail': data.get('thumbnailUrl') or f'https://i.ytimg.com/vi/{video_id}/mqdefault.jpg',
                    'duration': data.get('duration'),
                    'source': 'piped',
                }
            except Exception as e:
                logger.warning(f'⚠️ Piped {instance} stream failed: {e}')
                continue

        logger.warning(f'⚠️ All Piped instances failed for {video_id}')
        return None

    # ── Invidious helper ──────────────────────────────────────────────────────
    def _try_invidious(self, video_id: str) -> dict | None:
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
                audio_streams = [
                    f for f in data.get('adaptiveFormats', [])
                    if f.get('type', '').startswith('audio/')
                ]
                if not audio_streams:
                    continue

                best = sorted(audio_streams, key=lambda x: x.get('bitrate', 0), reverse=True)[0]
                stream_url = best.get('url')
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


class YouTubeStreamProxyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        video_id = request.data.get('videoId', '').strip()
        if not video_id:
            return Response({'error': 'Video ID required'}, status=400)

        cookie_file = _get_cookie_file()
        strategies = _build_ytdlp_strategies(cookie_file)

        for label, ydl_opts in strategies:
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
                logger.warning(f'⚠️ ProxyView [{label}] failed: {e}')
                continue

        return Response({'error': 'Stream unavailable'}, status=503)