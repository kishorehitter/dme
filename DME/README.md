# DME - Frontend

React Native mobile application for DME.

## Features

- **Email OTP Authentication** - Register and login with email verification
- **Real-time Chat** - WebSocket-based instant messaging
- **Chat List** - View all conversations with unread counts
- **One-on-One Chats** - Private messaging with other users
- **Typing Indicators** - See when others are typing
- **Read Receipts** - Double check marks for message status
- **WhatsApp-like UI** - Familiar green theme and message bubbles

## Tech Stack

- React Native 0.84
- TypeScript
- React Navigation (Stack + Tabs)
- Axios for API calls
- WebSocket for real-time messaging
- AsyncStorage for token persistence

## Setup

### Prerequisites

- Node.js 20+
- npm or yarn
- Android Studio (for Android emulator)
- Xcode (for iOS simulator, macOS only)

### Installation

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure API URL in `src/services/api.ts` and `src/services/websocket.ts`:

   ```typescript
   // For Android emulator
   const API_BASE_URL = 'http://10.0.2.2:8000/api';

   // For iOS simulator
   // const API_BASE_URL = 'http://localhost:8000/api';

   // For physical device (replace with your computer's IP)
   // const API_BASE_URL = 'http://192.168.1.100:8000/api';
   ```

3. Start Metro bundler:

   ```bash
   npm start
   ```

4. Run on Android:

   ```bash
   npm run android
   ```

5. Run on iOS (macOS only):
   ```bash
   npm run ios
   ```

## Project Structure

```
src/
├── components/     # Reusable UI components
├── context/        # React Context providers (Auth)
├── navigation/     # React Navigation configuration
├── screens/        # Screen components
│   ├── auth/       # Login, Register, OTP screens
│   └── chat/       # Chat list, Chat room screens
├── services/       # API and WebSocket services
├── types/          # TypeScript type definitions
└── utils/          # Utilities and theme
```

## Available Scripts

- `npm start` - Start Metro bundler
- `npm run android` - Run on Android
- `npm run ios` - Run on iOS
- `npm test` - Run tests
- `npm run lint` - Run linter

## API Configuration

The app connects to the Django backend at `http://10.0.2.2:8000` (Android emulator).

Update these files for different environments:

- `src/services/api.ts` - REST API configuration
- `src/services/websocket.ts` - WebSocket configuration

## Authentication Flow

1. **Register** → User creates account with email/password
2. **OTP Verification** → User receives 6-digit code via email
3. **Login** → User logs in with email/password to get JWT tokens
4. **Auto-login** → App uses stored tokens for subsequent launches

## Chat Features

- Real-time messaging via WebSocket
- Message status (sent, delivered, read)
- Typing indicators
- Unread message counts
- Conversation list with last message preview
