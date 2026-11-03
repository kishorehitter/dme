# DME - Frontend Mobile Application

High-performance, real-time multimedia communication, entertainment, and calling app built with **React Native 0.84**, **TypeScript**, and **Nitro Architecture**.

---

## 🎬 Native YouTube & Media Streaming Architecture (Rave-Style)

DME features a complete client-side adaptive streaming pipeline matching the native Rave playback architecture:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT-SIDE STREAMING PIPELINE                            │
│                                                                                        │
│   1. Mobile Watch Page Extractor                                                       │
│      m.youtube.com/watch?v={id} ──► Fetches all 29+ Adaptive Formats (144p - 4K)       │
│                                           │                                            │
│                                           ▼                                            │
│   2. Meriyah AST Sandbox Worker (In-App Sandbox)                                       │
│      YouTubeDecipherWorker.tsx ──► Deciphers 's' signature & solves 'n' throttler      │
│                                    in ~240ms directly on device (Zero backend proxy)   │
│                                           │                                            │
│                                           ▼                                            │
│   3. Dynamic MPEG-DASH Manifest Generator                                              │
│      TrackPlayerService.ts ──► Synthesizes local MPD with separate Audio (Opus/AAC)    │
│                                & Video (AVC1/VP9/AV01) adaptation sets                 │
│                                           │                                            │
│                                           ▼                                            │
│   4. Native ExoPlayer Direct Playback (react-native-video)                             │
│      DirectVideoPlayer.tsx ──► Plays local .mpd descriptor with mobile spoofed headers │
│                                Instant dynamic quality switching (144p ──► 4K)         │
│                                           │                                            │
│                      ┌────────────────────┴────────────────────┐                       │
│                      ▼                                         ▼                       │
│   5. Resilient Multi-Tier Fallback           6. Smart Recommendation Engine             │
│      • Tier 1: Native DASH ExoPlayer            (DiscoveryFeedService.ts)              │
│      • Tier 2: Progressive MP4 (itag 18/22)     • 0ms Instant Rave Swipe UX            │
│      • Tier 3: YouTube IFrame Player            • Prioritizes Same Channel / Artist    │
│      • Cloud: Google Drive Chunk Stream         • User Liked Songs & Watch History     │
│                                                 • Harvested YouTube Home Feed           │
│                                                 • Image.prefetch() Thumbnail Caching   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Core Streaming Components
- **`DirectVideoPlayer.tsx`**: Native video player leveraging Android ExoPlayer to load dynamically assembled DASH MPD manifests with custom headers (`User-Agent: YOUTUBE_MOBILE_USER_AGENT`, `Referer: https://www.youtube.com/`).
- **`YouTubeDecipherWorker.tsx` & `YouTubeDecipherService.ts`**: Pure client-side JavaScript AST engine that deciphers signature ciphers and bypasses throttle challenges in <250ms with zero backend proxy latency.
- **`TrackPlayerService.ts`**: Manages background audio via `@rntp/player` and dynamically constructs local `.mpd` XML descriptors.
- **`DiscoveryFeedService.ts`**: Instant smart recommendation engine that prioritizes same-channel videos, liked tracks, watch history, and harvested YouTube home feed videos with background image pre-caching.
- **`MusicRoomScreen.tsx`**: Synchronized playback coordinator connecting with Django Channels WebSocket (`ws/music/{room_code}/`) for clock synchronization, DJ queue management, seek scrubbing, and in-room chat.

---

## 📱 Key Features

### 1. Collaborative Music & Video Room
- **Synchronized Playback**: Sub-second sync across participants via server clock timestamps.
- **Host / DJ Controls**: Play, pause, seek, pass-aux, and queue management.
- **Rave-Style Related Videos**: 0ms instant display upon horizontal swipe.
- **Seamless Background Playback**: Audio continues when minimized or device is locked.

### 2. Real-Time Chat & Media Sharing
- **WebSocket Messaging**: Bidirectional chat, sent/delivered/read receipts, typing indicators.
- **Rich Reactions**: 60fps native particle burst reactions on double tap.
- **Media & Stickers**: Multi-image picker, native `RichTextInput` supporting keyboard stickers and GIFs.

### 3. 24-Hour Stories (Status)
- Photo, video, and stylized text statuses disappearing after 24 hours.
- Segmented progress bar, touch pause-and-hold, custom privacy lists.

### 4. Voice & Video Calling (WebRTC / LiveKit)
- 1-on-1 and group calls powered by LiveKit SFU.
- Full-screen native incoming call UI via Notifee.

### 5. Solo & Challenge Trivia
- Solo trivia sets with progressive difficulty and English/Tamil bilingual support.
- Interactive challenge links directly in chat.

---

## 🛠️ Tech Stack

- **Framework**: React Native 0.84.1
- **Language**: TypeScript 5.8
- **Navigation**: React Navigation v7 (Native Stack + Bottom Tabs)
- **Audio & Video Engine**: `@rntp/player`, `react-native-video` (ExoPlayer), `react-native-sound`
- **Calling**: LiveKit React Native SDK + WebRTC
- **Push Notifications**: Firebase Cloud Messaging (FCM) + Notifee
- **Local Database**: `react-native-nitro-sqlite` + `@react-native-async-storage/async-storage`
- **Networking**: Axios (REST APIs) + Native WebSockets (`Django Channels`)

---

## 📂 Project Structure

```
src/
├── assets/             # Icons, sounds, stickers, and static assets
├── components/         # Core reusable components
│   ├── DirectVideoPlayer.tsx       # Native ExoPlayer DASH player
│   ├── YouTubeDecipherWorker.tsx   # AST deciphering sandbox worker
│   ├── RelatedVideosGrid.tsx       # Instant related videos overlay
│   ├── YoutubePlayer.tsx           # WebView fallback player
│   ├── DrivePlayer.tsx             # Google Drive stream player
│   ├── StatusViewer.tsx            # Stories / Status viewer
│   ├── ChatInputArea.tsx           # Expandable chat input bar
│   └── ...
├── context/            # Global state (AuthContext, CallContext, ThemeContext)
├── hooks/              # Custom hooks (useMusicRoom, useChat, etc.)
├── navigation/         # AppNavigator & Screen routing
├── screens/            # Application screens
│   ├── MusicRoomScreen.tsx         # Collaborative streaming room
│   ├── YouTubeDiscoveryScreen.tsx  # In-app YouTube browser & feed scraper
│   ├── CallScreen.js               # Audio/Video calling screen
│   ├── StatusEditorScreen.tsx      # Status creator
│   └── ...
├── services/           # Network & background services
│   ├── YouTubeDecipherService.ts   # Video extractor & cipher solver
│   ├── DiscoveryFeedService.ts     # Smart recommendation engine
│   ├── TrackPlayerService.ts       # Background playback & MPD generator
│   ├── MusicWebSocketService.ts    # Room sync WebSocket client
│   ├── api.ts                      # Backend REST client
│   └── LocalDatabase.ts            # Nitro SQLite wrapper
└── utils/              # Color theme, helpers, and formatters
```

---

## 🚀 Setup & Execution

### Prerequisites
- Node.js 20+
- Android Studio with Android SDK (API 34+)

### Installation
```bash
# Install dependencies
npm install

# Start Metro Bundler
npm start

# Run on connected Android device / emulator
npm run android
```
