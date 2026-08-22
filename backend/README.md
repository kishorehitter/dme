# DME - Backend (Django ASGI)

A high-performance Django REST Framework and Django Channels backend providing real-time WebSocket communication, media streaming, LiveKit WebRTC signaling, push notifications, and entertainment services for DME.

---

## 🏗️ Backend Apps & Modules

| App | Description | Key Capabilities |
|---|---|---|
| **`accounts`** | User Identity & Profiles | Google OAuth, JWT authentication, user profile setup, friend requests, user blocking, and account management. |
| **`chat`** | Real-Time Messaging & Status | 1-on-1 & Group chat, typing indicators, read receipts, double-tap & emoji reactions, message unsend/delete, 24-hr multimedia Stories/Status with viewer tracking. |
| **`calls`** | Voice & Video Calling | 1-on-1 and Group WebRTC call signaling, LiveKit SFU access token generation, call history logs. |
| **`music`** | Collaborative Music Room | YouTube & Google Drive synchronized playback, DJ queue control, millisecond-accurate seek sync, room chat, watch history, and likes. |
| **`trivia`** | Interactive Trivia Game | Solo scoring, multilingual questions (English & Tamil), custom question sets, and in-chat direct trivia challenge creation/claiming. |
| **`notifications`** | Push Notifications | Firebase Cloud Messaging (FCM HTTP v1) integration for high-priority incoming calls, room invites, and background message delivery. |
| **`youtube_search`** | YouTube Metadata Proxy | In-app YouTube video search, related video discovery, and stream metadata extraction with cookie rotation. |

---

## ⚡ Real-Time WebSocket Routes

| WebSocket Endpoint | Consumer | Event Handlers |
|---|---|---|
| `ws/chat/<conversation_id>/` | `ChatConsumer` | New message, message edit, message delete, reactions, typing indicator, mark read. |
| `ws/music/<room_code>/` | `MusicRoomConsumer` | Sync play/pause/seek, queue add/remove/reorder, live room reactions & chat, host delegation. |
| `ws/calls/<user_id>/` | `CallConsumer` | Incoming call offer, call answer, call reject, call ended, group call invites. |
| `ws/presence/` | `PresenceConsumer` | Online/offline status broadcasting and heartbeat ping. |

---

## 🚀 Setup & Execution

### 1. Prerequisites
- Python 3.10+
- Virtual environment in root (`.venv`)
- Redis server (recommended for production Channel layers)

### 2. Installation
```bash
# Activate virtual environment
cd C:\Dev\AndroidApp
.venv\Scripts\activate

# Navigate to backend
cd backend

# Install dependencies
pip install -r requirements.txt

# Run database migrations
python manage.py migrate
```

### 3. Running with Daphne (ASGI)
Django Channels requires an ASGI server to handle both HTTP and WebSocket traffic:

```bash
# Run with Daphne (port 8000)
daphne -b 0.0.0.0 -p 8000 myproject.asgi:application

# Or standard Django development server
python manage.py runserver 0.0.0.0:8000
```

---

## 📡 Core API Summary

### Authentication & Profile
- `POST /api/accounts/google/` - Google OAuth authentication
- `GET /api/accounts/profile/` - Current user profile
- `POST /api/accounts/profile/update/` - Update profile details & avatar
- `GET /api/accounts/friends/` - List user friends
- `POST /api/accounts/friends/requests/` - Send/list friend requests

### Chat & Status
- `GET /api/chat/conversations/` - List conversations
- `GET /api/chat/conversations/<id>/messages/` - Paginated message history
- `POST /api/chat/conversations/<id>/messages/` - Upload & send message
- `POST /api/chat/messages/<id>/react/` - Toggle message reaction
- `GET /api/chat/statuses/` - Fetch 24-hr active stories/statuses
- `POST /api/chat/statuses/` - Post text or media status

### Music Room & Entertainment
- `GET /api/music/youtube/search/?q=<query>` - Search YouTube
- `GET /api/music/youtube/related/?videoId=<id>` - Suggested related tracks
- `POST /api/music/invite/` - Send room invite notification
- `POST /api/trivia/challenge/create/` - Create trivia challenge

### Calls & WebRTC
- `POST /api/calls/initiate/` - Start audio/video call
- `POST /api/calls/livekit/token/` - Generate LiveKit token for SFU room
- `GET /api/calls/history/` - Call logs & history
