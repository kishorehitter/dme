# music/views.py — Production ready, fully merged

import json
import hashlib
import logging
import urllib.parse
import yt_dlp
import requests
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from rest_framework.parsers import MultiPartParser, FormParser
from django.contrib.auth import get_user_model
from django.conf import settings
from django.core.cache import cache
from notifications.fcm_service import FCMService
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from .models import MusicWatchHistory, MusicLike
from .serializers import MusicWatchHistorySerializer, MusicLikeSerializer

logger = logging.getLogger(__name__)
User   = get_user_model()

# ─── Redis client with Django cache fallback ──────────────────────────────────
try:
    import redis as _redis
    _redis_url = getattr(settings, 'REDIS_URL', 'redis://localhost:6379')
    redis_client = _redis.from_url(
        _redis_url,
        decode_responses=True,
        socket_connect_timeout=5,
        socket_timeout=5,
    )
    redis_client.ping()
    USE_REDIS = True
    logger.info(f'✅ Redis connected successfully via URL')
except Exception as e:
    logger.warning(f'⚠️  Redis unavailable: {e} — falling back to Django cache')
    redis_client = None
    USE_REDIS    = False

# ─── Constants ────────────────────────────────────────────────────────────────
CACHE_TTL       = 86400          # 24 hours for search results
CACHE_TTL_EMPTY = 1800           # 30 min for empty results
MAX_RESULTS_CAP = 20             # hard cap — never request more than 20

PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://piped-api.garudalinux.org',
    'https://api.piped.projectsegfau.lt',
    'https://pipedapi.in',                   # 4th instance added
    'https://piped.adminforge.de/api',       # 5th instance added
]


# ─────────────────────────────────────────────────────────────────────────────
# Shared normalizer — ALL sources produce this exact same shape
# React Native code never needs to change regardless of which source responds
# ─────────────────────────────────────────────────────────────────────────────
def _normalize(video_id: str, title: str, channel: str, thumbnail: str = '', duration: int = 0) -> dict:
    if not thumbnail:
        thumbnail = f'https://i.ytimg.com/vi/{video_id}/mqdefault.jpg'
    return {
        'id': {'videoId': video_id},
        'snippet': {
            'title':        title        or 'Unknown',
            'channelTitle': channel      or 'Unknown',
            'thumbnails':   {'medium': {'url': thumbnail}},
        },
        'contentDetails': {
            'duration': duration  # duration in seconds
        }
    }


# ─────────────────────────────────────────────────────────────────────────────
# ISO 8601 Duration Parser (for YouTube API fallback)
# Converts "PT5M30S" to 330
# ─────────────────────────────────────────────────────────────────────────────
def _parse_iso_duration(duration_str: str) -> int:
    import re
    if not duration_str:
        return 0
    pattern = re.compile(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?')
    match = pattern.match(duration_str)
    if not match:
        return 0
    hours   = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds


# ─────────────────────────────────────────────────────────────────────────────
# Cache helpers — Redis primary, Django cache fallback
# ─────────────────────────────────────────────────────────────────────────────
def _cache_key(query: str) -> str:
    return f'yt_search:{hashlib.md5(query.lower().strip().encode()).hexdigest()}'


def _get_cached(query: str):
    key = _cache_key(query)
    try:
        if USE_REDIS and redis_client:
            raw = redis_client.get(key)
            if raw:
                logger.info(f'✅ Redis cache HIT: "{query}"')
                return json.loads(raw)
        else:
            hit = cache.get(key)
            if hit:
                logger.info(f'✅ Django cache HIT: "{query}"')
                return hit
    except Exception as e:
        logger.warning(f'⚠️  Cache GET error: {e}')
    return None


def _set_cached(query: str, result: dict) -> None:
    key = _cache_key(query)
    ttl = CACHE_TTL if result.get('items') else CACHE_TTL_EMPTY
    try:
        if USE_REDIS and redis_client:
            redis_client.setex(key, ttl, json.dumps(result))
            logger.info(f'✅ Redis cached "{query}" (TTL {ttl}s)')
        else:
            cache.set(key, result, ttl)
            logger.info(f'✅ Django cached "{query}" (TTL {ttl}s)')
    except Exception as e:
        logger.warning(f'⚠️  Cache SET error: {e}')


# ─────────────────────────────────────────────────────────────────────────────
# Source 1 — yt-dlp (PRIMARY)
# Unlimited, free, no API key. Searches YouTube directly.
# ─────────────────────────────────────────────────────────────────────────────
def _search_ytdlp(query: str, max_res: int) -> dict | None:
    try:
        ydl_opts = {
            'quiet':         True,
            'no_warnings':   True,
            'extract_flat':  True,   # metadata only — no download, very fast
            'skip_download': True,
            'socket_timeout': 10,
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f'ytsearch{max_res}:{query}', download=False)

        if not info or 'entries' not in info:
            return None

        items = []
        for entry in info.get('entries', []):
            if not entry:
                continue
            video_id = entry.get('id', '').strip()
            if not video_id:
                continue
            items.append(_normalize(
                video_id = video_id,
                title    = entry.get('title', ''),
                channel  = entry.get('channel') or entry.get('uploader', ''),
                duration = int(entry.get('duration') or 0),
            ))

        if not items:
            return None

        logger.info(f'✅ yt-dlp: {len(items)} results for "{query}"')
        return {'items': items}

    except Exception as e:
        logger.warning(f'⚠️  yt-dlp failed for "{query}": {e}')
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Source 2 — Piped API (FALLBACK)
# Unlimited, free. Tries each instance until one responds.
# ─────────────────────────────────────────────────────────────────────────────
def _search_piped(query: str, max_res: int) -> dict | None:
    for instance in PIPED_INSTANCES:
        try:
            response = requests.get(
                f'{instance}/search',
                params={'q': query, 'filter': 'videos'},
                timeout=6,
                headers={'User-Agent': 'Mozilla/5.0'}
            )
            if response.status_code != 200:
                continue

            items = []
            for item in response.json().get('items', []):
                if item.get('type') != 'stream':
                    continue
                raw_url  = item.get('url', '')
                video_id = raw_url.replace('/watch?v=', '').strip()
                if not video_id:
                    continue
                items.append(_normalize(
                    video_id  = video_id,
                    title     = item.get('title', ''),
                    channel   = item.get('uploaderName', ''),
                    thumbnail = item.get('thumbnail', ''),
                    duration  = int(item.get('duration') or 0),
                ))
                if len(items) >= max_res:
                    break

            if items:
                logger.info(f'✅ Piped ({instance}): {len(items)} results for "{query}"')
                return {'items': items}

        except Exception as e:
            logger.warning(f'⚠️  Piped {instance} failed: {e}')
            continue

    logger.warning(f'⚠️  All Piped instances failed for "{query}"')
    return None

def _get_related_fallback(videoId: str) -> dict | None:
    # 1. First, get the title of the current video so we can search related content
    try:
        ydl_opts = {'quiet': True, 'no_warnings': True, 'skip_download': True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f'https://www.youtube.com/watch?v={videoId}', download=False)
        
        if not info or 'title' not in info:
            return None
        
        # 2. Search for related videos using the title
        search_query = f"{info['title']} related"
        logger.info(f'🔍 Searching for related: "{search_query}"')
        
        return _search_ytdlp(search_query, 12)
        
    except Exception as e:
        logger.error(f'❌ Related fetch exception for "{videoId}": {e}')
        return None

# ... (rest of the view logic remains the same)

@method_decorator(csrf_exempt, name='dispatch')
class YoutubeRelatedView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        videoId = request.data.get('videoId', '').strip()
        if not videoId:
            return Response({'error': 'videoId is required'}, status=status.HTTP_400_BAD_REQUEST)

        # ✅ FIX: Use reliable yt-dlp search-based fallback
        result = _get_related_fallback(videoId)
        
        if not result:
            return Response({'error': 'Related videos unavailable'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        
        return Response(result, status=status.HTTP_200_OK)


# ─────────────────────────────────────────────────────────────────────────────
# Source 3 — YouTube Data API v3 (LAST RESORT)
# 100 units/day free. Only used when yt-dlp AND Piped both fail.
# ─────────────────────────────────────────────────────────────────────────────
def _search_youtube_api(query: str, max_res: int) -> dict | None:
    api_key = getattr(settings, 'YOUTUBE_API_KEY', '')
    if not api_key:
        logger.warning('⚠️  YOUTUBE_API_KEY not set — skipping API fallback')
        return None

    try:
        # Search for IDs and Snippets
        search_response = requests.get(
            'https://www.googleapis.com/youtube/v3/search',
            params={
                'q':          query,
                'part':       'snippet',
                'type':       'video',
                'maxResults': max_res,
                'key':        api_key,
            },
            timeout=10
        )

        if search_response.status_code != 200:
            return None

        search_data = search_response.json()
        video_ids = [item['id']['videoId'] for item in search_data.get('items', []) if 'videoId' in item.get('id', {})]
        
        if not video_ids:
            return None

        # Fetch ContentDetails for durations
        details_response = requests.get(
            'https://www.googleapis.com/youtube/v3/videos',
            params={
                'id':   ','.join(video_ids),
                'part': 'contentDetails,snippet',
                'key':  api_key,
            },
            timeout=10
        )

        if details_response.status_code != 200:
            return None

        details_data = details_response.json()
        items = []

        for item in details_data.get('items', []):
            video_id = item.get('id', '')
            snippet  = item.get('snippet', {})
            details  = item.get('contentDetails', {})
            
            items.append(_normalize(
                video_id  = video_id,
                title     = snippet.get('title', ''),
                channel   = snippet.get('channelTitle', ''),
                thumbnail = snippet.get('thumbnails', {}).get('medium', {}).get('url', ''),
                duration  = _parse_iso_duration(details.get('duration', '')),
            ))

        if not items:
            return None

        logger.info(f'✅ YouTube API: {len(items)} results for "{query}"')
        return {'items': items}

    except Exception as e:
        logger.warning(f'⚠️  YouTube API failed for "{query}": {e}')
        return None


# ─────────────────────────────────────────────────────────────────────────────
# YoutubeSearchView
#
# POST /api/music/youtube/search/
# Body: { "query": "shape of you", "maxResults": 15 }
#
# Pipeline:
#   1. Redis / Django cache (24h TTL)   → instant, free
#   2. yt-dlp                           → unlimited, free
#   3. Piped API (5 instances)          → unlimited, free
#   4. YouTube Data API                 → last resort
# ─────────────────────────────────────────────────────────────────────────────
class YoutubeSearchView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        query   = request.data.get('query', '').strip()
        max_res = min(int(request.data.get('maxResults', 15)), MAX_RESULTS_CAP)

        # ── validation ────────────────────────────────────────────────────────
        if not query:
            return Response(
                {'error': 'query is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if len(query) < 2:
            return Response(
                {'error': 'query must be at least 2 characters'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # ── 1. cache ──────────────────────────────────────────────────────────
        cached = _get_cached(query)
        if cached is not None:
            return Response(cached, status=status.HTTP_200_OK)

        logger.info(f'🔍 Cache MISS — searching: "{query}"')

        # ── 2. yt-dlp ─────────────────────────────────────────────────────────
        result = _search_ytdlp(query, max_res)

        # ── 3. Piped fallback ─────────────────────────────────────────────────
        if not result:
            logger.info(f'↩️  Falling back to Piped for "{query}"')
            result = _search_piped(query, max_res)

        # ── 4. YouTube API last resort ────────────────────────────────────────
        if not result:
            logger.info(f'↩️  Falling back to YouTube API for "{query}"')
            result = _search_youtube_api(query, max_res)

        # ── all sources failed ────────────────────────────────────────────────
        if not result:
            return Response(
                {'error': 'Search temporarily unavailable. Please try again.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        # ── cache and return ──────────────────────────────────────────────────
        _set_cached(query, result)
        return Response(result, status=status.HTTP_200_OK)


# ─────────────────────────────────────────────────────────────────────────────
# InviteToMusicRoomView — unchanged from your original
# ─────────────────────────────────────────────────────────────────────────────
class InviteToMusicRoomView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        raw_user_ids = request.data.get('user_ids', [])
        # Deduplicate user IDs to prevent multiple invites to the same user
        user_ids = list(set(raw_user_ids))
        room_code = request.data.get('room_code')
        video_id  = request.data.get('video_id')
        idempotency_key = request.data.get('idempotency_key')

        if idempotency_key:
            cache_key = f'invite_key_{idempotency_key}'
            if cache.get(cache_key):
                logger.info(f'⚠️ Duplicate invite request blocked. Key: {idempotency_key}')
                return Response({'message': 'Invitations already sent'}, status=status.HTTP_200_OK)
            cache.set(cache_key, True, 60)

        # Log received request for debugging
        logger.info(f'📩 Processing invites. Room: {room_code}, Users: {len(user_ids)}, User IDs: {user_ids}')

        if not room_code:
            return Response(
                {'error': 'room_code is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if not user_ids:
            return Response(
                {'error': 'user_ids is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        inviter_name = request.user.display_name or request.user.email

        import uuid
        notif_id = str(uuid.uuid4())
        notification_data = {
            'type':         'music_invite',
            'notif_id':     notif_id,
            'room_code':    str(room_code),
            'video_id':     str(video_id) if video_id else '',
            'inviter_name': inviter_name,
            'inviter_id':   str(request.user.id),
            'notif_title':  'Watch Together Invitation',
            'notif_body':   f'{inviter_name} invited you to watch a video together!',
        }

        success_count = 0
        failed_users  = []

        for user_id in user_ids:
            try:
                recipient = User.objects.get(id=user_id)
                # Send data-only notification (notification=None)
                FCMService.send_to_user(recipient, None, notification_data)
                success_count += 1
                logger.info(f'✅ Invite sent to {recipient.email}')
            except User.DoesNotExist:
                failed_users.append(user_id)
                logger.warning(f'⚠️  User not found: {user_id}')
            except Exception as e:
                failed_users.append(user_id)
                logger.error(f'❌ Error sending invite to {user_id}: {e}')

        return Response({
            'message':         f'Invitations sent to {success_count} user(s)',
            'success_count':   success_count,
            'failed_count':    len(failed_users),
            'failed_user_ids': failed_users,
        }, status=status.HTTP_200_OK)


class MusicRoomMediaUploadView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        file_obj = request.FILES.get('media_file')
        room_code = request.data.get('room_code')
        if not file_obj or not room_code:
            return Response({'error': 'No file or room_code provided'}, status=status.HTTP_400_BAD_REQUEST)

        import cloudinary.uploader
        try:
            # Upload to a room-specific folder in Cloudinary
            folder_path = f"music_chat_media/room_{room_code}"
            upload_result = cloudinary.uploader.upload(
                file_obj,
                folder=folder_path,
                resource_type="auto"
            )
            
            secure_url = upload_result.get('secure_url')
            # Fix: Ensure URL has an extension so mobile clients (Fresco) handle it correctly
            file_format = upload_result.get('format')
            if file_format and not secure_url.lower().endswith(f".{file_format.lower()}"):
                secure_url = f"{secure_url}.{file_format}"

            return Response({'url': secure_url}, status=status.HTTP_201_CREATED)
        except Exception as e:
            logger.error(f"Cloudinary upload error: {e}")
            return Response({'error': 'Upload failed'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class MusicWatchHistoryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        history = MusicWatchHistory.objects.filter(user=request.user)
        serializer = MusicWatchHistorySerializer(history, many=True)
        return Response(serializer.data)

    def post(self, request):
        video_id = request.data.get('video_id')
        source = request.data.get('source', 'youtube')
        title = request.data.get('title')
        thumbnail = request.data.get('thumbnail')
        channel_title = request.data.get('channel_title')

        if not video_id or not title:
            return Response({'error': 'video_id and title are required'}, status=status.HTTP_400_BAD_REQUEST)

        # Update or create history entry
        history, created = MusicWatchHistory.objects.update_or_create(
            user=request.user,
            video_id=video_id,
            source=source,
            defaults={
                'title': title,
                'thumbnail': thumbnail,
                'channel_title': channel_title,
            }
        )
        
        # If not created, save to update the auto_now 'watched_at' timestamp
        if not created:
            history.save()

        return Response(MusicWatchHistorySerializer(history).data, status=status.HTTP_201_CREATED)

    def delete(self, request):
        video_id = request.query_params.get('video_id')
        source = request.query_params.get('source', 'youtube')
        
        if video_id:
            MusicWatchHistory.objects.filter(user=request.user, video_id=video_id, source=source).delete()
        else:
            MusicWatchHistory.objects.filter(user=request.user).delete()
            
        return Response(status=status.HTTP_204_NO_CONTENT)

class MusicLikeToggleView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        video_id = request.data.get('video_id')
        source = request.data.get('source', 'youtube')
        title = request.data.get('title')
        thumbnail = request.data.get('thumbnail')
        channel_title = request.data.get('channel_title')

        if not video_id:
            return Response({'error': 'video_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        like_qs = MusicLike.objects.filter(user=request.user, video_id=video_id, source=source)
        
        if like_qs.exists():
            like_qs.delete()
            return Response({'liked': False}, status=status.HTTP_200_OK)
        else:
            if not title:
                return Response({'error': 'title is required to like a video'}, status=status.HTTP_400_BAD_REQUEST)
            
            MusicLike.objects.create(
                user=request.user,
                video_id=video_id,
                source=source,
                title=title,
                thumbnail=thumbnail,
                channel_title=channel_title
            )
            return Response({'liked': True}, status=status.HTTP_201_CREATED)

class MusicLikesListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        likes = MusicLike.objects.filter(user=request.user)
        serializer = MusicLikeSerializer(likes, many=True)
        return Response(serializer.data)

    def delete(self, request):
        video_id = request.query_params.get('video_id')
        source = request.query_params.get('source', 'youtube')
        
        if not video_id:
            return Response({'error': 'video_id is required'}, status=status.HTTP_400_BAD_REQUEST)
            
        MusicLike.objects.filter(user=request.user, video_id=video_id, source=source).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)