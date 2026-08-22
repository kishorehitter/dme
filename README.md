# DME (Direct Messaging & Entertainment)

A high-performance, real-time multimedia chat, collaborative entertainment, and calling platform built with **React Native 0.84** (Frontend) and **Django REST Framework + Django Channels (ASGI)** (Backend).

---

## 📱 System Overview & Architecture

```
                                  ┌─────────────────────────────────────────────────────────┐
                                  │                       CLIENT APP                        │
                                  │         React Native (0.84) • TypeScript • Nitro        │
                                  └───────────────┬─────────────────────────┬───────────────┘
                                                  │                         │
                                      REST APIs   │                         │  WebSockets (WSS)
                                      (Axios)     │                         │  (Django Channels)
                                                  ▼                         ▼
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                                     DJANGO BACKEND (ASGI)                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │     Accounts     │  │   Chat & Media   │  │   Calls (WebRTC) │  │ Collaborative     │  │
│  │ Google Auth,     │  │ 1-on-1, Groups,  │  │ LiveKit Engine,  │  │ Music Room        │  │
│  │ Profiles, Friends│  │ Stories, Status  │  │ Voice & Video    │  │ YT Sync, DJ Queue │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  └─────────┬─────────┘  │
│           │                     │                     │                      │            │
│  ┌────────┴─────────────────────┴─────────────────────┴──────────────────────┴─────────┐  │
│  │                       FCM Notifications & Trivia Challenge Engine                   │  │
│  └──────────────────────────────────────┬──────────────────────────────────────────────┘  │
└─────────────────────────────────────────┼─────────────────────────────────────────────────┘
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
     ┌────────────────────────┐                      ┌────────────────────────┐
     │   SQLite / PostgreSQL  │                      │      Redis Channel     │
     │    (Primary Relational)│                      │    Layer (WebSocket)   │
     └────────────────────────┘                      └────────────────────────┘
```

---

## ✨ Key Features & Capabilities

### 💬 1. Real-Time Chat & Direct Messaging
- **1-on-1 & Group Chats**: Instant messaging powered by WebSockets with bidirectional state sync.
- **Message Lifecycle**: Accurate `sent`, `delivered`, and `read` status indicators.
- **Rich Interactive Reactions**: 
  - Double-tap with animated particle bursts (100% UI-thread native acceleration).
  - Quick emoji reactions and custom emoji picker.
  - Transparent large emoji rendering for emoji-only messages.
- **Rich Media & File Sharing**:
  - Multi-image and video sending with interactive grid view.
  - Image markup & sketch canvas editor (draw, crop, rotate, caption).
  - Audio voice notes with playback progress and waveforms.
  - Document & file sharing.
  - Lottie animated stickers & built-in curated sticker packs.
  - Android native `RichTextInput` supporting Gboard direct GIF/sticker insertion.
- **Message Management**: Reply/quote messages, message editing with `(edited)` badges, unsend/delete for everyone or delete for self.
- **Typing & Presence**: Live typing indicators and real-time online/offline presence tracking.

### ⭕ 2. 24-Hour Status & Stories
- **Multimedia Stories**: Post photos, videos, or stylized text statuses that disappear after 24 hours.
- **Story Viewer**: Instagram/WhatsApp-style segmented progress bar, pause-on-hold, tap navigation, and status replies.
- **Status Privacy Controls**: Fine-grained privacy (Everyone, My Contacts, Contacts Except..., Only Share With...).
- **Viewers & Receipts**: Real-time list of users who viewed your status.

### 🎧 3. Collaborative Music Room (Synchronized Playback)
- **Synchronized Video/Audio Playback**: Watch YouTube videos or Google Drive media synchronously across all room members.
- **Live Seek & Clock Synchronization**: Millisecond-accurate playback position sync via server timestamps.
- **Host / DJ Mode**: The DJ controls queue order, play/pause, and skip, while participants can request songs.
- **Dynamic YouTube Search & Suggestions**: In-app YouTube search, channel metadata extractor, and smart recommendations.
- **Background Audio Support**: Powered by React Native Track Player for continuous background audio.
- **In-Room Chat & Mini Player**: Floating mini player and chat overlay while browsing discovery queues.

### 📞 4. Voice & Video Calling (WebRTC / LiveKit)
- **1-on-1 & Group Calling**: Ultra-low-latency voice and video calls powered by LiveKit SFU.
- **In-Call Controls**: Camera switch, mic mute, speaker toggle, and network health monitor.
- **Notifee Full-Screen Incoming Call UI**: Native high-priority incoming call screen with Accept / Decline actions even when the device is locked.
- **Call Logs & History**: Complete incoming, outgoing, and missed call tracking.

### 🧠 5. Solo & Challenge Trivia Game
- **Solo Mode**: Multiple categories (General Knowledge, Science, Cinema, Tamil Cinema, History, Sports) with progressive difficulty and sets.
- **Multilingual Support**: Full English and Tamil translation toggle for questions and options.
- **Custom Trivia Sets**: In-app custom question builder and JSON question-pack importer/exporter.
- **Direct Trivia Challenges**: Send trivia challenge cards in chats with interactive claim & play links.
- **Leaderboards & Scores**: Local SQLite database storage (`react-native-nitro-sqlite`) and synced scoreboards.

### 🛡️ 6. Friends, Privacy & Authentication
- **Google OAuth & JWT**: Secure passwordless Google Sign-In with JWT refresh token rotation.
- **Friend Request System**: Send, accept, reject, or cancel friend requests.
- **Message Requests**: Incoming messages from non-friends routed to Message Requests for safety.
- **Block & Privacy**: Block/unblock users with instant socket disconnect and mutual profile hiding.

---

## 🛠️ Technology Stack

### Frontend (Mobile App)
| Layer | Technology |
|---|---|
| **Framework** | [React Native 0.84.1](https://reactnative.dev/) (New Architecture ready) |
| **Language** | [TypeScript 5.8](https://www.typescriptlang.org/) |
| **Navigation** | [React Navigation v7](https://reactnavigation.org/) (Native Stack + Bottom Tabs) |
| **WebRTC & Calling** | [LiveKit React Native SDK](https://livekit.io/) + `@livekit/react-native-webrtc` |
| **Notifications** | [Firebase Cloud Messaging (FCM)](https://rnfirebase.io/) + [Notifee](https://notifee.app/) |
| **Animations** | [React Native Reanimated 4](https://docs.swmansion.com/react-native-reanimated/) + [Lottie](https://airbnb.io/lottie/) |
| **Local Storage & Database** | [Nitro SQLite](https://github.com/nitro/sqlite) + AsyncStorage |
| **Audio & Video** | `@rntp/player`, `react-native-video`, `react-native-sound` |
| **Native Components** | Custom Kotlin `RichTextInput` (ReactEditText) with IME Commit & Auto-growth |

### Backend (Server)
| Layer | Technology |
|---|---|
| **Framework** | [Django 4.2 / 5.x](https://www.djangoproject.com/) + [Django REST Framework](https://www.django-rest-framework.org/) |
| **Realtime Engine** | [Django Channels](https://channels.readthedocs.io/) + [Daphne ASGI](https://github.com/django/daphne) |
| **Channel Layer** | Redis / In-Memory Channel Layer |
| **Database** | SQLite (Dev) / PostgreSQL (Prod) |
| **Push Gateway** | Firebase Admin SDK (FCM HTTP v1) |
| **Media Pipeline** | FFmpeg / PyTube / yt-dlp metadata proxies |

---

## 📂 Project Directory Structure

```
AndroidApp/
├── backend/                        # Django ASGI Server
│   ├── accounts/                   # Auth, User Profiles, User Blocking, Friends
│   ├── calls/                      # Voice & Video Signaling, LiveKit Tokens, Call History
│   ├── chat/                       # 1-on-1 & Group Chats, Messages, Reactions, Stories (Status)
│   ├── music/                      # Music Room Sync, YouTube Search/Proxy, Watch History
│   ├── notifications/              # FCM Push Notification Dispatchers
│   ├── trivia/                     # Trivia Challenge API & Scoring
│   ├── youtube_search/             # YouTube Metadata Extractor & Discovery
│   ├── myproject/                  # Project ASGI/WSGI & Router Configuration
│   ├── manage.py                   # Django Management CLI
│   └── requirements.txt            # Python Dependencies
│
├── DME/                            # React Native Client App
│   ├── android/                    # Android Native Project (Kotlin/Java)
│   │   └── app/src/main/java/com/DME/
│   │       ├── RichTextInput.kt    # Custom Native EditText for IME Stickers & Multiline
│   │       └── ...
│   ├── src/
│   │   ├── assets/                 # Built-in Trivia Questions & Media Assets
│   │   ├── components/             # Reusable UI Components
│   │   │   ├── ChatInputArea.tsx   # Expandable Input Bar with Media Picker & Stickers
│   │   │   ├── DoubleTapHeartOverlay.tsx # 60fps Native Particle Burst Reaction
│   │   │   ├── StatusViewer.tsx    # 24hr Stories Player & Gesture Controller
│   │   │   ├── YoutubePlayer.tsx   # Synchronized Room Player
│   │   │   ├── CustomGalleryPicker.tsx # Multi-asset Gallery Selector
│   │   │   └── ...
│   │   ├── context/                # Global React Contexts (Auth, Calling, Notifications)
│   │   ├── navigation/             # AppNavigator & Stack/Tab Declarations
│   │   ├── screens/                # Application Screens
│   │   │   ├── auth/               # Login, Profile Setup, Google Auth
│   │   │   ├── chat/               # ChatList, ChatRoom, StatusPrivacy, Friends
│   │   │   ├── MusicRoomScreen.tsx # Collaborative Music Sync Screen
│   │   │   ├── CallScreen.js       # LiveKit Video/Voice Room UI
│   │   │   ├── StatusEditorScreen.tsx # Status Creator (Draw, Text, Media)
│   │   │   ├── TriviaSoloScreen.tsx# Solo Trivia Game with Tamil/English Mode
│   │   │   └── ...
│   │   ├── services/               # API, WebSockets, FCM, SQLite, Audio Services
│   │   │   ├── api.ts              # Axios REST Client
│   │   │   ├── websocket.ts        # Chat & Presence WebSocket Client
│   │   │   ├── MusicWebSocketService.ts # Room State Synchronizer
│   │   │   ├── fcm.ts              # Background Notification & Call Handler
│   │   │   ├── LocalDatabase.ts    # Nitro SQLite Engine
│   │   │   └── TrackPlayerService.ts # Background Music Controller
│   │   ├── types/                  # TypeScript Data Models & Nav Types
│   │   └── utils/                  # Theme, Audio Helpers, Formatters
│   ├── App.tsx                     # Root App Entry
│   └── package.json                # NPM Dependencies & Scripts
```

---

## 🚀 Getting Started

### 1. Backend Setup

```bash
# 1. Activate Python virtual environment
cd C:\Dev\AndroidApp
.venv\Scripts\activate

# 2. Navigate to backend directory
cd backend

# 3. Apply database migrations
python manage.py migrate

# 4. Start ASGI server with Daphne (Required for WebSockets)
daphne -b 0.0.0.0 -p 8000 myproject.asgi:application
# Or use:
python manage.py runserver 0.0.0.0:8000
```

### 2. Frontend Setup

```bash
# 1. Navigate to DME frontend directory
cd C:\Dev\AndroidApp\DME

# 2. Install Node dependencies
npm install

# 3. Start Metro bundler
npm start

# 4. Launch on Android emulator or connected device
npm run android
```

---

## 📡 API & WebSocket Reference

### Key REST Endpoints

| Module | Method | Endpoint | Description |
|---|---|---|---|
| **Auth** | `POST` | `/api/accounts/google/` | Google OAuth Login / Register |
| **Auth** | `GET` | `/api/accounts/profile/` | Fetch current user profile |
| **Chat** | `GET` | `/api/chat/conversations/` | List all direct and group chats |
| **Chat** | `GET` | `/api/chat/conversations/{id}/messages/` | Paginated message history |
| **Chat** | `POST` | `/api/chat/messages/{id}/react/` | Add/remove message reaction |
| **Status** | `GET/POST`| `/api/chat/statuses/` | Fetch & post 24-hr disappearing statuses |
| **Music** | `GET` | `/api/music/youtube/search/?q={query}` | Search YouTube videos |
| **Music** | `POST` | `/api/music/invite/` | Invite user to Music Room |
| **Calls** | `POST` | `/api/calls/initiate/` | Initiate 1-on-1 audio/video call |
| **Calls** | `POST` | `/api/calls/livekit/token/` | Generate LiveKit SFU access token |
| **Trivia** | `POST` | `/api/trivia/challenge/create/` | Create shareable trivia challenge |

### Real-Time WebSocket Routes

| Route | Consumer | Purpose |
|---|---|---|
| `ws/chat/{conversation_id}/` | `ChatConsumer` | Real-time messages, typing indicators, read receipts, reactions |
| `ws/music/{room_code}/` | `MusicRoomConsumer` | Room playback sync, DJ controls, live room chat, participant queue |
| `ws/calls/{user_id}/` | `CallConsumer` | Incoming/outgoing call signaling and invitations |
| `ws/presence/` | `PresenceConsumer` | Global user online/offline status and heartbeat |

---

## 📄 License
This project is licensed under the MIT License.
