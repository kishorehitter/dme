# music/views.py — Production ready, fully merged

import os
import http.cookiejar
import json
import hashlib
import logging
import urllib.parse
import threading
import time
import asyncio
import certifi
import httpx
import yt_dlp
import requests
from concurrent.futures import ThreadPoolExecutor
from django.http import HttpResponse, StreamingHttpResponse
from asgiref.sync import sync_to_async
from django.views import View
from youtube_search.views import get_youtube_cookie_file
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from rest_framework.parsers import MultiPartParser, FormParser
from django.contrib.auth import get_user_model
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

# ─── Only keep instances reliably reachable from Render (datacenter IPs) ──────
# Removed: piped-api.garudalinux.org  — DNS fails on Render
#          pipedapi.in                — DNS fails on Render
#          piped.adminforge.de/api    — DNS resolution broken on Render
PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.projectsegfau.lt',
    'https://piped.video/api',
    'https://piped-api.privacy.com.de',
    'https://pipedapi.reallyaweso.me',
]

# ─── yt-dlp player clients to try in order (bypasses bot-check on server IPs) ─
YTDLP_PLAYER_CLIENTS = [
    ['android_testsuite'],
    ['tv_embedded'],
    ['android'],
    ['mweb'],
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
        cookie_file = get_youtube_cookie_file()
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
        if cookie_file:
            ydl_opts['cookiefile'] = cookie_file

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


# ─────────────────────────────────────────────────────────────────────────────
# Related-video metadata fetch + keyword-based content filtering
#
# IMPORTANT, confirmed in conversation: YouTube's public search/yt-dlp search
# does NOT expose true metadata filters (genre, language, "is this a song vs
# a movie clip vs comedy skit"). What follows is a deliberate, approved
# approximation — derive signal from the TITLE and CHANNEL NAME only (the
# only two fields we reliably have), strip generic marketing noise that
# dilutes search relevance, and bias the query toward same-channel +
# same-detected-content-type results. This is keyword search, not real
# metadata filtering. All results still come from YouTube search — never
# from our own DB, per spec.
# ─────────────────────────────────────────────────────────────────────────────

def _get_video_metadata_ytdlp(video_id: str) -> dict | None:
    """
    Fetch a video's full metadata (title, channel, upload date, categories)
    using yt-dlp with multiple player clients.
    """
    cookie_file = get_youtube_cookie_file()
    url = f'https://www.youtube.com/watch?v={video_id}'
    for clients in YTDLP_PLAYER_CLIENTS:
        try:
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'skip_download': True,
                'extract_flat': False,  # Changed to False to retrieve complete categories/dates
                'socket_timeout': 10,
                'extractor_args': {
                    'youtube': {
                        'player_client': clients,
                    }
                },
            }

            if cookie_file:
                ydl_opts['cookiefile'] = cookie_file

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
            if info and info.get('title'):
                upload_date = info.get('upload_date')
                year = None
                if upload_date and isinstance(upload_date, str) and len(upload_date) >= 4:
                    year = upload_date[:4]

                categories = info.get('categories')
                category = categories[0] if categories and isinstance(categories, list) else None

                return {
                    'title': info['title'],
                    'channel': info.get('channel') or info.get('uploader') or '',
                    'year': year,
                    'category': category,
                    'language': info.get('language'),
                }
        except Exception as e:
            logger.warning(f'⚠️ Metadata fetch client={clients} failed for {video_id}: {e}')
            continue
    return None


# Backward-compatible wrapper — kept in case any other call site still
# expects a bare title string.
def _get_video_title_ytdlp(video_id: str) -> str | None:
    meta = _get_video_metadata_ytdlp(video_id)
    return meta['title'] if meta else None


# Generic marketing/noise words that appear in tons of unrelated titles and
# actively hurt search relevance if left in the query (e.g. "Official",
# "HD", "Full Video" appear on nearly every upload regardless of content).
_NOISE_WORDS = {
    'official', 'video', 'full', 'hd', '4k', 'audio', 'lyrical', 'lyric',
    'song', 'movie', 'trailer', 'teaser', 'new', 'latest', 'exclusive',
    'release', 'music', 'mv', 'live', 'concert', 'stream', 'streaming',
}

# Content-type hint words — if present in the title, bias the related
# search toward the SAME content type (e.g. don't surface a comedy skit as
# "related" to a live concert just because a keyword happened to overlap).
_CONTENT_TYPE_HINTS = {
    'comedy':  ['comedy', 'funny', 'spoof', 'troll', 'meme'],
    'live':    ['live', 'concert', 'streaming now', '🔴'],
    'song':    ['song', 'audio', 'lyrical', 'lyric video', 'full song'],
    'trailer': ['trailer', 'teaser', 'first look'],
}


def _detect_content_type(title: str) -> str | None:
    lower = title.lower()
    for content_type, hints in _CONTENT_TYPE_HINTS.items():
        if any(hint in lower for hint in hints):
            return content_type
    return None


def _build_related_query(title: str, channel: str) -> str:
    """
    Builds a keyword search query biased toward: same channel, same
    detected content type, with generic noise words stripped so the
    remaining proper nouns (movie name, performer name, song name) drive
    the match instead of being diluted.
    """
    import re

    content_type = _detect_content_type(title)

    # Strip bracketed/parenthetical tags ("(Official Video)", "[4K]") and
    # pipe/bullet-separated trailing taglines — these are pure noise for
    # search relevance and often duplicate the noise words filtered below,
    # so removing the whole chunk is more reliable than per-word filtering.
    cleaned = re.sub(r'[\(\[].*?[\)\]]', ' ', title)
    cleaned = re.split(r'[|\u2022]', cleaned)[0]  # cut at first | or •

    words = re.findall(r"[\w']+", cleaned.lower())
    meaningful = [w for w in words if w not in _NOISE_WORDS and len(w) > 1]
    keyword_core = ' '.join(meaningful[:8]) or cleaned.strip()

    parts = [keyword_core]
    if channel:
        parts.append(channel)
    if content_type:
        parts.append(content_type)
    parts.append('related')

    return ' '.join(p for p in parts if p).strip()


def _normalize_title_for_comparison(t: str) -> str:
    """
    Cleans a video title (removes parentheticals, music noise words, non-alphanumeric chars)
    and sorts the words alphabetically to create a canonical string for de-duplicating similar tracks.
    """
    import re
    # Remove bracketed and parenthetical noise blocks
    t_clean = re.sub(r'[\(\[].*?[\)\]]', ' ', t.lower())
    # Strip common metadata tags
    for tag in ['official', 'video', 'lyrics', 'lyric', 'audio', 'full', 'hd', 'mv', 'song', 'live', 'concert', 'related']:
        t_clean = t_clean.replace(tag, '')
    # Extract alphanumeric words and sort them to handle title ordering variations
    words = re.findall(r'[a-zA-Z0-9]+', t_clean)
    words.sort()
    return ''.join(words)


def _get_related_fallback(videoId: str) -> dict | None:
    """
    Fetch related videos from YouTube, matching:
    1. Same Channel (Uploader)
    2. Same Genre/Category + Year (and language matching via core keywords)
    3. Standard Related search fallback
    Searches are executed concurrently in a thread pool to preserve fast response times.
    Title de-duplication is enforced to avoid repeating identical tracks.
    """
    import concurrent.futures
    import re
    try:
        meta = _get_video_metadata_ytdlp(videoId)

        if not meta:
            logger.warning(f'⚠️ Could not fetch metadata for {videoId}, using ID as query')
            return _search_ytdlp(videoId, 12)

        title = meta['title']
        channel = meta['channel']
        year = meta.get('year')
        category = meta.get('category')

        # Build specific recommendation queries
        # Query 1: Same Channel
        query_channel = f'"{channel}"' if channel else ""

        # Query 2: Genre/Category + Year (retaining core keywords for language context)
        cleaned = re.sub(r'[\(\[].*?[\)\]]', ' ', title)
        cleaned = re.split(r'[|\u2022]', cleaned)[0]
        words = re.findall(r"[\w']+", cleaned.lower())
        meaningful = [w for w in words if w not in _NOISE_WORDS and len(w) > 1]
        core_keywords = ' '.join(meaningful[:4])

        query_genre_year = []
        if core_keywords:
            query_genre_year.append(core_keywords)
        if year:
            query_genre_year.append(year)
        if category:
            query_genre_year.append(category)

        query_genre_year_str = ' '.join(query_genre_year).strip()

        # Query 3: Standard Related
        query_standard = _build_related_query(title, channel)

        logger.info(f'🔍 Concurrently searching related - Channel: "{query_channel}", Genre/Year: "{query_genre_year_str}", Std: "{query_standard}"')

        # Run up to 3 searches in parallel to optimize latency
        search_targets = []
        if query_channel:
            search_targets.append((query_channel, 8))
        if query_genre_year_str:
            search_targets.append((query_genre_year_str, 8))
        if query_standard:
            search_targets.append((query_standard, 8))

        results_list = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            future_to_query = {
                executor.submit(_search_ytdlp, q, limit): q
                for q, limit in search_targets
            }
            for future in concurrent.futures.as_completed(future_to_query):
                q = future_to_query[future]
                try:
                    res = future.result()
                    if res and 'items' in res:
                        results_list.append(res['items'])
                except Exception as exc:
                    logger.error(f'Search query "{q}" generated an exception: {exc}')

        # Interleave the different search buckets to form a diverse recommendation list
        combined_items = []
        seen_ids = {videoId}
        
        # Seed seen titles with the current video's title to avoid proposing the same track
        seen_titles = {_normalize_title_for_comparison(title)}

        max_len = max(len(lst) for lst in results_list) if results_list else 0
        for i in range(max_len):
            for lst in results_list:
                if i < len(lst):
                    item = lst[i]
                    v_id = item.get('id', {}).get('videoId')
                    if v_id and v_id not in seen_ids:
                        # Extract title and perform de-duplication check
                        item_title = item.get('snippet', {}).get('title', '')
                        norm_title = _normalize_title_for_comparison(item_title)
                        
                        # Only include if we haven't seen a highly similar title structure
                        if norm_title not in seen_titles:
                            seen_ids.add(v_id)
                            seen_titles.add(norm_title)
                            combined_items.append(item)

        final_results = combined_items[:15]
        logger.info(f'✅ Extracted {len(final_results)} related videos after title de-duplication')
        return {'items': final_results}

    except Exception as e:
        logger.error(f'❌ Related fetch exception for "{videoId}": {e}')
        return None


@method_decorator(csrf_exempt, name='dispatch')
class YoutubeRelatedView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        videoId = request.data.get('videoId', '').strip()
        if not videoId:
            return Response({'error': 'videoId is required'}, status=status.HTTP_400_BAD_REQUEST)

        # ✅ FIX: Use reliable yt-dlp search-based fallback, now with
        # keyword/content-type/channel-aware filtering (see
        # _build_related_query above).
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


# ─────────────────────────────────────────────────────────────────────────────
# YoutubeStreamView — Extract stream URLs and return proxy endpoints
# YoutubeStreamProxyView — Proxy video bytes through the server (fixes IP lock)
# ─────────────────────────────────────────────────────────────────────────────

# Standard quality buckets — snap raw heights to nearest standard bucket
STANDARD_HEIGHTS = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320]

QUALITY_LABELS = {
    4320: '8K 4320p', 2160: '4K 2160p', 1440: '2K 1440p', 1080: '1080p FHD',
    720: '720p HD', 480: '480p SD', 360: '360p',
    240: '240p', 144: '144p',
}

def snap_to_standard_height(raw_height, format_id=''):
    """
    Snap a raw pixel height to standard quality bucket using cinema-aspect-ratio aware ranges.
    Widescreen/anamorphic videos (2.39:1, 16:9 letterboxed) have lower pixel heights:
      - 360p cinema ratio: 640x270 or 640x272
      - 480p cinema ratio: 854x360 or 854x362
      - 720p cinema ratio: 1280x540 or 1280x544
      - 1080p cinema ratio: 1920x800 or 1920x816
      - 1440p cinema ratio: 2560x1080 or 2560x1088
      - 2160p cinema ratio: 3840x1600 or 3840x1632
    """
    if not raw_height or raw_height < 100:
        return None
    if str(format_id) == '18':
        return 360
    if raw_height >= 1500:
        return 2160
    elif raw_height >= 1000:
        return 1440
    elif raw_height >= 700:
        return 1080
    elif raw_height >= 480:
        return 720
    elif raw_height >= 320:
        return 480
    elif raw_height >= 230:
        return 360
    elif raw_height >= 160:
        return 240
    else:
        return 144


# Thread-safe extraction lock and cooldown tracker to prevent thundering-herd extractions
# and stop Django/Daphne from freezing when multiple chunk requests arrive simultaneously.
_video_extraction_locks = {}
_video_locks_guard = threading.Lock()
_last_video_extraction = {}

def get_video_lock(video_id):
    with _video_locks_guard:
        if video_id not in _video_extraction_locks:
            _video_extraction_locks[video_id] = threading.Lock()
        return _video_extraction_locks[video_id]


class YoutubeStreamView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    CACHE_TTL = 60 * 15       # 15 min metadata cache
    URL_CACHE_TTL = 60 * 12   # 12 min URL cache (YouTube URLs expire ~6h but we refresh often)
    CACHE_PREFIX = 'yt_stream_v17_'      # ✅ bumped to v17: multi-client full quality ladder
    URL_CACHE_PREFIX = 'yt_url_v17_'

    def get(self, request, video_id):
        if not video_id or len(video_id) > 20:
            return Response({'error': 'Invalid video_id'}, status=status.HTTP_400_BAD_REQUEST)

        cache_key = f"{self.CACHE_PREFIX}{video_id}"
        cached = cache.get(cache_key)
        if cached:
            return Response(cached)

        try:
            result = self._extract_and_store(video_id, request)
            return Response(result)
        except Exception as e:
            logger.error(f"[Stream] Failed for {video_id}: {e}")
            return Response(
                {'error': 'Could not extract stream URLs. Video may be restricted.'},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )

    def _extract_and_store(self, video_id, request, force=False):
        import os
        import time

        cache_key = f"{self.CACHE_PREFIX}{video_id}"
        lock = get_video_lock(video_id)

        with lock:
            now = time.time()
            last = _last_video_extraction.get(video_id, 0)
            cached = cache.get(cache_key)

            # If cached and extracted recently (< 60s), reuse cache immediately
            if cached and not force and (now - last < 60):
                return cached

            # Cooldown even on 403 retry: do not re-run yt-dlp more than once every 20s for the same video
            if force and (now - last < 20):
                if cached:
                    return cached

            # Cooldown: never run yt-dlp on the same video concurrently or within 30s
            if not force and (now - last < 30):
                if cached:
                    return cached
                # Wait briefly for in-flight extraction to populate cache
                for _ in range(20):
                    time.sleep(0.5)
                    cached = cache.get(cache_key)
                    if cached:
                        return cached

            _last_video_extraction[video_id] = now

        cookie_file = None
        try:
            cookie_file = get_youtube_cookie_file()
        except Exception:
            pass
        if not cookie_file:
            local_cookies = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'cookies.txt')
            if os.path.exists(local_cookies):
                cookie_file = local_cookies

        def _extract_for_client(client_name):
            opts = {
                'quiet': True,
                'no_warnings': True,
                'skip_download': True,
                'nocheckcertificate': True,
                'format': None,
                'ignore_no_formats_error': True,
                'socket_timeout': 12,
                'extractor_args': {
                    'youtube': {
                        'player_client': [client_name],
                    },
                },
            }
            if os.name != 'nt':
                opts['source_address'] = '0.0.0.0'
            if cookie_file:
                opts['cookiefile'] = cookie_file
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    return ydl.extract_info(f'https://www.youtube.com/watch?v={video_id}', download=False)
            except Exception as ex:
                logger.warning(f"[Stream] Extraction with client {client_name} failed for {video_id}: {ex}")
                return None

        info_tv = None
        info_android = None
        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                fut_tv = executor.submit(_extract_for_client, 'tv_embedded')
                fut_android = executor.submit(_extract_for_client, 'android')
                info_tv = fut_tv.result()
                info_android = fut_android.result()
        except Exception as te:
            logger.warning(f"[Stream] Parallel extraction failed: {te}")

        info = info_tv or info_android
        formats_tv = [f for f in (info_tv.get('formats') if info_tv else []) if str(f.get('format_id')) != '18']
        formats_android = [f for f in (info_android.get('formats') if info_android else []) if str(f.get('format_id')) == '18']
        formats = formats_tv + formats_android

        # Fallback if tv_embedded or android was empty
        if not formats:
            logger.info(f"[Stream] tv_embedded/android empty, trying android_creator fallback for {video_id}")
            fallback = _extract_for_client('android_creator') or _extract_for_client('web')
            if fallback:
                info = fallback
                formats = fallback.get('formats', [])

        if not info or not formats:
            raise RuntimeError(f"Could not extract formats for {video_id}")

        # ── Debug: log what clients and heights were actually extracted ──────────
        _seen_clients = set()
        _seen_heights = set()
        for _f in formats:
            _url = _f.get('url', '')
            for _c in ['WEB', 'MWEB', 'ANDROID_VR', 'ANDROID', 'IOS', 'TVHTML5']:
                if f'c={_c}' in _url:
                    _seen_clients.add(_c)
            if _f.get('height'):
                _seen_heights.add(_f['height'])
        logger.info(f"[Stream] {video_id}: extracted {len(formats)} formats | clients={_seen_clients} | heights={sorted(_seen_heights)}")

        # ── Audio-only stream capture ──────────────────────────────────────────
        best_audio = None
        for f in formats:
            url = f.get('url', '')
            if not url:
                continue
            vcodec = f.get('vcodec') or 'none'
            acodec = f.get('acodec') or 'none'
            if vcodec != 'none':
                continue  # skip video streams
            if acodec == 'none':
                continue  # skip streams with no audio
            abr = f.get('abr') or f.get('tbr') or 0
            ext = f.get('ext') or ''

            # Skip TVHTML5 which fails CDN requests
            if 'c=TVHTML5' in url:
                continue

            # Prioritize m4a/mp4a audio (itag 140)
            is_m4a = ext in ('m4a', 'mp4') or 'mp4a' in acodec
            curr_is_m4a = best_audio and (best_audio.get('ext') in ('m4a', 'mp4') or 'mp4a' in best_audio.get('acodec', ''))

            should_replace = False
            if best_audio is None:
                should_replace = True
            elif is_m4a and not curr_is_m4a:
                should_replace = True
            elif is_m4a == curr_is_m4a and abr > (best_audio.get('abr') or best_audio.get('tbr') or 0):
                should_replace = True

            if should_replace:
                best_audio = {
                    'url': url,
                    'ext': ext if ext else 'm4a',
                    'acodec': acodec,
                    'abr': abr,
                    'filesize': f.get('filesize') or f.get('filesize_approx') or 0,
                    'http_headers': f.get('http_headers', {}),
                }

        # Group raw streams by snapped standard height
        # key: (standard_height, has_audio)  value: best format dict
        buckets = {}
        for f in formats:
            url = f.get('url', '')
            if not url:
                continue

            vcodec = f.get('vcodec') or 'none'
            acodec = f.get('acodec') or 'none'
            raw_height = f.get('height') or 0

            # Skip audio-only and unknown video
            if vcodec == 'none' or raw_height < 100:
                continue

            has_audio = acodec != 'none'

            # Skip TVHTML5 and Oculus VR format 18 (which returns 403)
            if 'c=TVHTML5' in url or (str(f.get('format_id')) == '18' and 'c=ANDROID_VR' in url):
                continue

            std_height = snap_to_standard_height(raw_height, format_id=f.get('format_id', ''))
            if not std_height:
                continue

            key = (std_height, has_audio)

            # Prefer higher bitrate within same bucket
            tbr = f.get('tbr') or f.get('vbr') or 0
            existing = buckets.get(key)
            if existing is None or tbr > existing.get('tbr', 0):
                buckets[key] = {
                    'url': url,
                    'height': std_height,
                    'raw_height': raw_height,
                    'width': f.get('width') or 0,
                    'vcodec': vcodec,
                    'acodec': acodec if has_audio else None,
                    'has_audio': has_audio,
                    'ext': f.get('ext', 'mp4'),
                    'tbr': tbr,
                    'filesize': f.get('filesize') or f.get('filesize_approx') or 0,
                    'http_headers': f.get('http_headers', {}),
                }

        # Store raw YouTube URLs in Redis (keyed by video_id + height + has_audio)
        for (std_height, has_audio), fmt in buckets.items():
            url_key = f"{self.URL_CACHE_PREFIX}{video_id}_{std_height}_{'av' if has_audio else 'v'}"
            cache.set(url_key, {
                'url': fmt['url'],
                'ext': fmt['ext'],
                'vcodec': fmt['vcodec'],
                'acodec': fmt['acodec'],
                'filesize': fmt.get('filesize', 0),
                'http_headers': fmt.get('http_headers', {}),
            }, self.URL_CACHE_TTL)

        # ── Audio source & proxy URL ───────────────────────────────────────────
        muxed_bucket = buckets.get((360, True)) or next((fmt for (h, a), fmt in buckets.items() if a), None)
        audio_source = best_audio or muxed_bucket
        audio_proxy_url = None
        if audio_source:
            audio_cache_key = f"{self.URL_CACHE_PREFIX}{video_id}_0_a"
            cache.set(audio_cache_key, {
                'url': audio_source['url'],
                'ext': audio_source.get('ext', 'mp4'),
                'vcodec': 'none',
                'acodec': audio_source.get('acodec') or 'mp4a.40.2',
                'filesize': audio_source.get('filesize', 0),
                'http_headers': audio_source.get('http_headers', {}),
            }, self.URL_CACHE_TTL)
            try:
                audio_proxy_url = request.build_absolute_uri(
                    f"/api/music/youtube/proxy/{video_id}/0/a.mp4"
                )
            except Exception:
                host = request.META.get('HTTP_HOST', '10.83.11.247:8000')
                scheme = 'https' if request.is_secure() else 'http'
                audio_proxy_url = f"{scheme}://{host}/api/music/youtube/proxy/{video_id}/0/a.mp4"

        # Build stream list for the app
        # Prefer muxed (has_audio=True) per height, fall back to video-only with linked audio_proxy_url
        final_streams = []
        seen_heights = set()

        # Pass 1: muxed streams (have audio — these work standalone)
        for std_height in sorted(buckets.keys(), key=lambda k: k[0], reverse=True):
            h, has_audio = std_height
            if has_audio and h not in seen_heights:
                seen_heights.add(h)
                fmt = buckets[std_height]
                final_streams.append(self._build_stream_entry(video_id, h, fmt, 'av', request, audio_proxy_url))

        # Pass 2: video-only streams for heights we don't have muxed (paired with audio_proxy_url)
        for std_height in sorted(buckets.keys(), key=lambda k: k[0], reverse=True):
            h, has_audio = std_height
            if not has_audio and h not in seen_heights:
                seen_heights.add(h)
                fmt = buckets[std_height]
                final_streams.append(self._build_stream_entry(video_id, h, fmt, 'v', request, audio_proxy_url))

        # Sort highest quality first
        final_streams.sort(key=lambda x: x['height'], reverse=True)
        logger.info(f"[Buckets] {video_id}: buckets={list(buckets.keys())} | final_streams count={len(final_streams)} heights={[s['height'] for s in final_streams]}")

        # ── Generate DASH MPD manifest ─────────────────────────────────────────
        duration_secs = info.get('duration', 0) or 0
        dash_mpd = self._build_dash_mpd(video_id, final_streams, audio_proxy_url, duration_secs, request)
        dash_cache_key = f"yt_dash_v17_{video_id}"
        cache.set(dash_cache_key, dash_mpd, self.URL_CACHE_TTL)

        # Build the DASH manifest URL the app will call
        try:
            dash_url = request.build_absolute_uri(f"/api/music/youtube/dash/{video_id}/")
        except Exception:
            host = request.META.get('HTTP_HOST', '10.83.11.247:8000')
            scheme = 'https' if request.is_secure() else 'http'
            dash_url = f"{scheme}://{host}/api/music/youtube/dash/{video_id}/"

        result = {
            'video_id': video_id,
            'title': info.get('title', ''),
            'duration': duration_secs,
            'streams': final_streams,
            'dash_url': dash_url,
        }
        cache.set(cache_key, result, self.CACHE_TTL)
        return result

    def _build_dash_mpd(self, video_id, streams, audio_proxy_url, duration_secs, request, optional_heights=None):
        """
        Generate a MPEG-DASH MPD (Media Presentation Description) manifest.

        All media URLs point to our proxy endpoints so that:
        - The client (Android/ExoPlayer) only ever talks to our server.
        - IP-locking is handled transparently by the proxy layer.
        - ExoPlayer uses DashMediaSource which handles fMP4 fragmented containers.

        optional_heights: if provided, only include video representations for those heights.
        """
        # Format PT duration (e.g. PT3M45.0S)
        mins = int(duration_secs // 60)
        secs = duration_secs % 60
        pt_duration = f"PT{mins}M{secs:.3f}S" if mins else f"PT{secs:.3f}S"

        mp4_reps = []
        webm_reps = []
        for s in streams:
            h = s.get('height', 0)
            w = s.get('width', 0) or int(h * 16 / 9)
            # Bitrate estimate in bps
            bw = max(200000, h * h * 80)
            url = s.get('url', '')
            if not url or not h:
                continue
            if optional_heights and h not in optional_heights:
                continue

            vcodec = s.get('vcodec') or 'avc1.64001f'
            if vcodec.startswith('vp09') or vcodec.startswith('vp9'):
                mime = 'video/webm' if s.get('ext') == 'webm' else 'video/mp4'
                codec_str = vcodec if '.' in vcodec else 'vp09.00.50.08'
            elif vcodec.startswith('av01') or vcodec.startswith('av1'):
                mime = 'video/mp4'
                codec_str = vcodec if '.' in vcodec else 'av01.0.08M.10'
            elif vcodec.startswith('avc1') or vcodec.startswith('h264'):
                mime = 'video/mp4'
                codec_str = vcodec if '.' in vcodec else 'avc1.64001f'
            else:
                mime = 'video/mp4'
                codec_str = 'avc1.64001f'

            rep_xml = (
                f'      <Representation id="video_{h}p" mimeType="{mime}" '
                f'codecs="{codec_str}" bandwidth="{bw}" width="{w}" height="{h}">\n'
                f'        <BaseURL>{url}</BaseURL>\n'
                f'      </Representation>'
            )
            if mime == 'video/mp4':
                mp4_reps.append(rep_xml)
            else:
                webm_reps.append(rep_xml)

        video_adaptation = ''
        adapt_id = 1
        if mp4_reps:
            video_adaptation += (
                f'    <AdaptationSet id="{adapt_id}" contentType="video" mimeType="video/mp4" '
                'segmentAlignment="true">\n'
                + '\n'.join(mp4_reps) + '\n'
                '    </AdaptationSet>\n'
            )
            adapt_id += 1
        if webm_reps:
            video_adaptation += (
                f'    <AdaptationSet id="{adapt_id}" contentType="video" mimeType="video/webm" '
                'segmentAlignment="true">\n'
                + '\n'.join(webm_reps) + '\n'
                '    </AdaptationSet>\n'
            )
            adapt_id += 1

        audio_adaptation = ''
        if audio_proxy_url:
            audio_adaptation = (
                f'    <AdaptationSet id="{adapt_id}" mimeType="audio/mp4" contentType="audio" '
                'lang="und" segmentAlignment="true">\n'
                f'      <Representation id="audio_0" mimeType="audio/mp4" '
                f'codecs="mp4a.40.2" bandwidth="128000" audioSamplingRate="44100">\n'
                f'        <BaseURL>{audio_proxy_url}</BaseURL>\n'
                f'      </Representation>\n'
                f'    </AdaptationSet>\n'
            )

        mpd = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" '
            'profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" '
            f'type="static" mediaPresentationDuration="{pt_duration}" '
            'minBufferTime="PT1.5S">\n'
            '  <Period>\n'
            f'{video_adaptation}'
            f'{audio_adaptation}'
            '  </Period>\n'
            '</MPD>'
        )
        return mpd


    def _build_stream_entry(self, video_id, height, fmt, proxy_suffix, request, audio_proxy_url=None):
        label = QUALITY_LABELS.get(height, f'{height}p')
        proxy_path = f"/api/music/youtube/proxy/{video_id}/{height}/{proxy_suffix}.mp4"

        try:
            proxy_url = request.build_absolute_uri(proxy_path)
        except Exception:
            host = request.META.get('HTTP_HOST', '10.83.11.247:8000')
            scheme = 'https' if request.is_secure() else 'http'
            proxy_url = f"{scheme}://{host}{proxy_path}"

        return {
            'height': height,
            'width': fmt.get('width', 0),
            'quality': f'{height}p',
            'label': label,
            'url': proxy_url,           # ← proxy URL, not raw YouTube URL
            'audio_url': audio_proxy_url if not fmt.get('has_audio') else None,
            'has_audio': fmt['has_audio'],
            'vcodec': fmt['vcodec'],
            'acodec': fmt.get('acodec'),
            'ext': fmt.get('ext', 'mp4'),
        }


def _get_proxy_user_agent(yt_url: str, fmt_headers: dict | None = None) -> str:
    # Prioritize exact User-Agent assigned by yt-dlp for this specific format,
    # except OculusBrowser which triggers 403 on Google CDN
    if fmt_headers and fmt_headers.get('User-Agent'):
        ua = fmt_headers['User-Agent']
        if 'Oculus' not in ua:
            return ua
    if 'c=ANDROID' in yt_url and 'c=ANDROID_VR' not in yt_url:
        return 'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip'
    elif 'c=IOS' in yt_url:
        return 'com.google.ios.youtube/19.29.1 (iPhone14,3; U; CPU iOS 17_5_1 like Mac OS X;)'
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


@method_decorator(csrf_exempt, name='dispatch')
class YoutubeStreamProxyView(View):
    """
    Proxies YouTube video stream bytes through our server asynchronously.
    This is required because YouTube stream URLs are IP-locked:
    the URL must be requested from the same IP that extracted it.

    The phone sends:  GET /api/music/youtube/proxy/<video_id>/<height>/<suffix>/
    We look up the cached YouTube URL and stream bytes to the phone asynchronously.
    Supports Range requests so ExoPlayer can seek efficiently.
    Uses httpx.AsyncClient + async StreamingHttpResponse so client disconnects
    release the ASGI connection and abort the upstream YouTube request in < 1ms,
    preventing Daphne thread exhaustion and task kill freezes.
    """
    URL_CACHE_PREFIX = 'yt_url_v17_'  # ✅ must match YoutubeStreamView.URL_CACHE_PREFIX

    async def options(self, request, *args, **kwargs):
        response = HttpResponse()
        response['Access-Control-Allow-Origin'] = '*'
        response['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
        response['Access-Control-Allow-Headers'] = 'Range, range, Content-Type, Accept, Authorization, X-Requested-With, Origin, *'
        response['Access-Control-Expose-Headers'] = 'Content-Range, Content-Length, Accept-Ranges, Date, *'
        return response

    async def get(self, request, video_id, height, suffix):
        clean_suffix = suffix.replace('.mp4', '').replace('.m4a', '')
        url_key = f"{self.URL_CACHE_PREFIX}{video_id}_{height}_{clean_suffix}"
        cached_url_data = await sync_to_async(cache.get)(url_key)
        if not cached_url_data and clean_suffix != suffix:
            cached_url_data = await sync_to_async(cache.get)(f"{self.URL_CACHE_PREFIX}{video_id}_{height}_{suffix}")

        if not cached_url_data:
            # Cache miss — URL expired, need fresh extraction
            try:
                view = YoutubeStreamView()
                await sync_to_async(view._extract_and_store)(video_id, request)
                cached_url_data = (await sync_to_async(cache.get)(url_key)) or (await sync_to_async(cache.get)(f"{self.URL_CACHE_PREFIX}{video_id}_{height}_{suffix}"))
            except Exception as e:
                logger.error(f"[Proxy] Re-extraction failed for {video_id}/{height}/{suffix}: {e}")

        if not cached_url_data:
            return HttpResponse(status=404)

        yt_url = cached_url_data['url']
        range_header = request.META.get('HTTP_RANGE', '')

        fmt_headers = cached_url_data.get('http_headers') or {}
        proxy_ua = _get_proxy_user_agent(yt_url, fmt_headers)

        yt_headers = {
            'User-Agent': proxy_ua,
            'Accept': '*/*',
            'Accept-Encoding': 'identity',
        }
        for k, v in fmt_headers.items():
            if k.lower() not in ('host', 'content-length', 'transfer-encoding', 'range', 'accept-encoding', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-site', 'user-agent', 'accept'):
                yt_headers[k] = v
        yt_headers['Accept-Encoding'] = 'identity'
        yt_headers['User-Agent'] = proxy_ua

        # Ensure finite byte range chunking for adaptive streams (Google CDN returns 403 on open-ended or full-file requests)
        filesize = cached_url_data.get('filesize', 0)
        chunk_size = 512 * 1024 if height == 0 else 2 * 1024 * 1024  # 512KB for audio, 2MB for video

        formatted_range = None
        if range_header and 'null' not in range_header:
            clean_range = range_header.strip()
            if clean_range.startswith('bytes='):
                val = clean_range[6:]
                if '-' in val:
                    parts = val.split('-', 1)
                    s_str, e_str = parts[0].strip(), parts[1].strip()
                    if s_str and not e_str:
                        # Open-ended range like 'bytes=0-' or 'bytes=5000000-'
                        start = int(s_str)
                        calc_end = start + chunk_size - 1
                        if filesize and filesize > start:
                            calc_end = min(calc_end, filesize - 1)
                        # Avoid requesting full file on initial chunk
                        if start == 0 and filesize and filesize > chunk_size and calc_end >= filesize - 1:
                            calc_end = chunk_size - 1
                        formatted_range = f"bytes={start}-{calc_end}"
                    else:
                        formatted_range = clean_range

        if not formatted_range:
            end = min(chunk_size - 1, filesize - 1) if (filesize and filesize > chunk_size) else chunk_size - 1
            formatted_range = f"bytes=0-{end}"

        yt_headers['Range'] = formatted_range

        # Load session cookies ONLY for WEB/MWEB formats (sending web cookies on Android/VR formats triggers 403)
        cookies = None
        if ('c=WEB' in yt_url or 'c=MWEB' in yt_url):
            cookie_file = None
            try:
                cookie_file = get_youtube_cookie_file()
            except Exception:
                pass
            if not cookie_file:
                local_cookies = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'cookies.txt')
                if os.path.exists(local_cookies):
                    cookie_file = local_cookies

            if cookie_file and os.path.exists(cookie_file):
                try:
                    cj = http.cookiejar.MozillaCookieJar(cookie_file)
                    cj.load(ignore_discard=True, ignore_expires=True)
                    cookies = cj
                except Exception as ce:
                    logger.debug(f"[Proxy] Could not load cookies: {ce}")

        # On Windows, local_address="0.0.0.0" causes Winsock connect() hangs when virtual adapters (WSL/Hyper-V) exist.
        # Only bind local_address on POSIX/Linux if required.
        transport_kwargs = {'verify': certifi.where()}
        if os.name != 'nt':
            transport_kwargs['local_address'] = '0.0.0.0'

        transport = httpx.AsyncHTTPTransport(**transport_kwargs)
        client = httpx.AsyncClient(
            transport=transport,
            cookies=cookies,
            follow_redirects=True,
            timeout=httpx.Timeout(connect=15.0, read=30.0, write=15.0, pool=15.0)
        )

        try:
            req = client.build_request('GET', yt_url, headers=yt_headers)
            yt_resp = await client.send(req, stream=True)

            # If YouTube returned 403, retry once with refreshed URL (with debounced extraction)
            if yt_resp.status_code == 403:
                now = time.time()
                cached_now = (await sync_to_async(cache.get)(url_key)) or (await sync_to_async(cache.get)(f"{self.URL_CACHE_PREFIX}{video_id}_{height}_{suffix}"))
                if cached_now and cached_now.get('url') and cached_now['url'] != yt_url:
                    logger.info(f"[Proxy] Using freshly cached URL for {video_id}/{height} after 403")
                    await yt_resp.aclose()
                    yt_url = cached_now['url']
                    yt_headers['User-Agent'] = _get_proxy_user_agent(yt_url, cached_now.get('http_headers'))
                    req = client.build_request('GET', yt_url, headers=yt_headers)
                    yt_resp = await client.send(req, stream=True)
                else:
                    last_ext = _last_video_extraction.get(video_id, 0)
                    if now - last_ext >= 20:
                        logger.warning(f"[Proxy] Got 403 for {video_id}/{height}, refreshing stream URL and retrying once...")
                        await yt_resp.aclose()
                        view = YoutubeStreamView()
                        await sync_to_async(view._extract_and_store)(video_id, request, force=True)
                        cached_url_data = (await sync_to_async(cache.get)(url_key)) or (await sync_to_async(cache.get)(f"{self.URL_CACHE_PREFIX}{video_id}_{height}_{suffix}"))
                        if cached_url_data and cached_url_data.get('url'):
                            yt_url = cached_url_data['url']
                            yt_headers['User-Agent'] = _get_proxy_user_agent(yt_url, cached_url_data.get('http_headers'))
                            req = client.build_request('GET', yt_url, headers=yt_headers)
                            yt_resp = await client.send(req, stream=True)

            if yt_resp.status_code not in (200, 206):
                logger.warning(f"[Proxy] YouTube returned {yt_resp.status_code} for {video_id}/{height} on range '{yt_headers.get('Range')}'")
                await yt_resp.aclose()
                await client.aclose()
                resp = HttpResponse(status=yt_resp.status_code)
                resp['Access-Control-Allow-Origin'] = '*'
                resp['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
                resp['Access-Control-Allow-Headers'] = '*'
                if yt_resp.status_code == 416:
                    filesize = cached_url_data.get('filesize', 0)
                    resp['Content-Range'] = f"bytes */{filesize}"
                return resp

            content_type = yt_resp.headers.get('Content-Type', 'video/mp4')

            async def stream_generator():
                try:
                    async for chunk in yt_resp.aiter_bytes(chunk_size=65536):
                        if chunk:
                            yield chunk
                except (asyncio.CancelledError, GeneratorExit):
                    pass
                except Exception as e:
                    logger.debug(f"[Proxy] Stream generator interrupted: {e}")
                finally:
                    await yt_resp.aclose()
                    await client.aclose()

            response = StreamingHttpResponse(stream_generator(), status=yt_resp.status_code, content_type=content_type)
            response['Accept-Ranges'] = 'bytes'
            response['Access-Control-Allow-Origin'] = '*'
            response['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
            response['Access-Control-Allow-Headers'] = 'Range, range, Content-Type, Accept, Authorization, X-Requested-With, Origin, *'
            response['Access-Control-Expose-Headers'] = 'Content-Range, Content-Length, Accept-Ranges, Date, *'

            if 'Content-Range' in yt_resp.headers:
                response['Content-Range'] = yt_resp.headers['Content-Range']
            if 'Content-Length' in yt_resp.headers:
                response['Content-Length'] = yt_resp.headers['Content-Length']

            return response

        except httpx.TimeoutException:
            await client.aclose()
            resp = HttpResponse(status=504)
            resp['Access-Control-Allow-Origin'] = '*'
            return resp
        except Exception as e:
            await client.aclose()
            logger.error(f"[Proxy] Exception for {video_id}/{height}: {e}")
            resp = HttpResponse(status=500)
            resp['Access-Control-Allow-Origin'] = '*'
            return resp


class YoutubeDashManifestView(APIView):
    """
    Serves the MPEG-DASH MPD manifest for a YouTube video.

    ExoPlayer calls:  GET /api/music/youtube/dash/<video_id>/
                 or:  GET /api/music/youtube/dash/<video_id>/?q=720

    ?q=720 → only includes the 720p video representation (quality lock).
    No ?q   → includes all available video representations (adaptive).

    Permission is AllowAny because ExoPlayer cannot send JWT auth headers
    when making media requests. The MPD contains only proxy URLs (no raw
    YouTube URLs), so there is no sensitive data to protect.
    """
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request, video_id):
        if not video_id or len(video_id) > 20:
            return HttpResponse(status=400)

        # Optional quality filter (e.g. ?q=720 → only 720p video representation)
        quality_param = request.query_params.get('q', '').strip()
        only_height = None
        if quality_param.isdigit():
            only_height = int(quality_param)

        dash_cache_key = f"yt_dash_v16_{video_id}"  # ✅ bumped to v16
        # Stream list cache (needed to rebuild filtered manifest on-the-fly)
        stream_cache_key = f"yt_stream_v16_{video_id}"  # ✅ bumped to v16

        cached_result = cache.get(stream_cache_key)
        if not cached_result:
            # Full cache miss — re-extract everything
            try:
                view = YoutubeStreamView()
                cached_result = view._extract_and_store(video_id, request)
            except Exception as e:
                logger.error(f"[DASH] Re-extraction failed for {video_id}: {e}")
                return HttpResponse(status=503)

        if not cached_result:
            return HttpResponse(status=404)

        # If a specific quality is requested, build a fresh filtered manifest
        # (don't use the cached all-qualities MPD)
        if only_height:
            streams = cached_result.get('streams', [])
            duration_secs = cached_result.get('duration', 0) or 0
            available_heights = {s.get('height') for s in streams if s.get('height')}
            target_heights = {only_height}
            if available_heights and only_height not in available_heights:
                closest = min(available_heights, key=lambda x: abs(x - only_height))
                target_heights = {closest}

            # Reconstruct audio proxy url (pure audio 0/a.mp4)
            audio_path = f"/api/music/youtube/proxy/{video_id}/0/a.mp4"
            try:
                audio_proxy_url = request.build_absolute_uri(audio_path)
            except Exception:
                host = request.META.get('HTTP_HOST', '10.83.11.247:8000')
                scheme = 'https' if request.is_secure() else 'http'
                audio_proxy_url = f"{scheme}://{host}{audio_path}"

            view = YoutubeStreamView()
            mpd = view._build_dash_mpd(
                video_id, streams, audio_proxy_url, duration_secs, request,
                optional_heights=target_heights
            )
        else:
            # Use cached full-quality manifest
            mpd = cache.get(dash_cache_key)
            if not mpd:
                # Rebuild from cached stream result
                streams = cached_result.get('streams', [])
                duration_secs = cached_result.get('duration', 0) or 0
                audio_path = f"/api/music/youtube/proxy/{video_id}/0/a.mp4"
                try:
                    audio_proxy_url = request.build_absolute_uri(audio_path)
                except Exception:
                    host = request.META.get('HTTP_HOST', '10.83.11.247:8000')
                    scheme = 'https' if request.is_secure() else 'http'
                    audio_proxy_url = f"{scheme}://{host}{audio_path}"
                view = YoutubeStreamView()
                mpd = view._build_dash_mpd(video_id, streams, audio_proxy_url, duration_secs, request)
                cache.set(dash_cache_key, mpd, YoutubeStreamView.URL_CACHE_TTL)

        if not mpd:
            return HttpResponse(status=404)

        return HttpResponse(
            mpd,
            content_type='application/dash+xml',
            headers={
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': 'Range, range, Content-Type, Accept, Authorization, *',
                'Cache-Control': 'no-cache, no-store',
            },
        )