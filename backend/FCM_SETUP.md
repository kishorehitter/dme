# FCM Push Notifications Setup Guide

This guide explains how to set up Firebase Cloud Messaging (FCM) for push notifications in the DME chat application.

## Overview

The FCM integration includes:
- **Backend**: Django app for managing FCM devices and sending notifications
- **Frontend**: React Native service for handling FCM tokens and notifications

## Backend Setup

### 1. Install Dependencies

```bash
cd backend
pip install firebase-admin
```

### 2. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select existing one
3. Enable Cloud Messaging

### 3. Generate Service Account Key

1. In Firebase Console, go to **Project Settings** ⚙️
2. Go to **Service Accounts** tab
3. Click **Generate New Private Key**
4. Save the JSON file as `firebase-service-account.json` in the `backend/` directory

### 4. Configure Environment Variables

Add to your `.env` file:

```env
FIREBASE_CREDENTIALS_PATH=/path/to/firebase-service-account.json
```

Or place the file as `backend/firebase-service-account.json` (default location).

### 5. Run Migrations

```bash
python manage.py makemigrations notifications
python manage.py migrate
```

### 6. Update Settings (Optional)

In `myproject/settings.py`, you can configure:

```python
# Firebase Configuration
FIREBASE_CREDENTIALS_PATH = os.getenv('FIREBASE_CREDENTIALS_PATH', BASE_DIR / 'firebase-service-account.json')
FIREBASE_CONFIG = None  # Can be set to a dict with service account JSON
```

## Frontend Setup

### 1. Install Dependencies

```bash
cd frontend
npm install @react-native-firebase/app @react-native-firebase/messaging
```

### 2. Android Configuration

#### Add google-services.json

1. In Firebase Console, go to **Project Settings** ⚙️
2. Add an Android app with package name: `com.dme` (or your app's package name)
3. Download `google-services.json`
4. Place it in `frontend/android/app/`

#### Update `android/build.gradle`

```gradle
buildscript {
    dependencies {
        // ... other dependencies
        classpath 'com.google.gms:google-services:4.3.15'
    }
}
```

#### Update `android/app/build.gradle`

```gradle
apply plugin: 'com.android.application'
apply plugin: 'com.google.gms.google-services'  // Add this line

android {
    // ... existing config
}

dependencies {
    // ... other dependencies
    implementation platform('com.google.firebase:firebase-bom:32.7.0')
}
```

### 3. iOS Configuration

#### Add GoogleService-Info.plist

1. In Firebase Console, add an iOS app with your bundle identifier
2. Download `GoogleService-Info.plist`
3. Place it in `frontend/ios/`

#### Enable Push Notifications in Xcode

1. Open `frontend/ios/DME.xcworkspace` in Xcode
2. Select your target
3. Go to **Signing & Capabilities**
4. Click **+ Capability**
5. Add **Push Notifications**
6. Add **Background Modes** and enable **Remote notifications**

#### Install Pods

```bash
cd frontend/ios
pod install
```

### 4. Initialize FCM Service

In your main App component or navigation setup:

```typescript
import fcmService from './src/services/fcm';

// Initialize FCM when app starts
useEffect(() => {
  fcmService.initialize();
  
  return () => {
    fcmService.cleanup();
  };
}, []);
```

### 5. Handle Logout

```typescript
import fcmService from './src/services/fcm';

const handleLogout = async () => {
  await fcmService.unregisterDevice();
  // ... rest of logout logic
};
```

## API Endpoints

### Register Device
```http
POST /api/fcm/register/
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "device_id": "unique_device_identifier",
  "registration_token": "fcm_token_from_client",
  "platform": "android" | "ios" | "web"
}
```

### List Devices
```http
GET /api/fcm/list/
Authorization: Bearer <JWT_TOKEN>
```

### Remove Device
```http
POST /api/fcm/remove/
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "device_id": "unique_device_identifier"
}
```

### Test Notification
```http
POST /api/fcm/test/
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "title": "Test Notification",
  "body": "This is a test notification"
}
```

## How It Works

### Chat Message Flow

1. **User A sends a message** via WebSocket
2. **Backend checks** if recipients are online (via `last_seen` timestamp)
3. **If recipient is offline**:
   - Backend sends FCM push notification to recipient's devices
   - Notification includes message preview and conversation ID
4. **Recipient taps notification**:
   - App opens to the specific conversation
   - WebSocket connects and fetches new messages

### Notification Payload

```json
{
  "notification": {
    "title": "Sender Name",
    "body": "Message content..."
  },
  "data": {
    "type": "new_message",
    "conversation_id": "123",
    "message_id": "456",
    "sender_name": "Sender Name",
    "message_type": "text",
    "timestamp": "2024-01-01T12:00:00Z"
  }
}
```

## Testing

### Test Backend FCM

```bash
# Get JWT token first
curl -X POST http://localhost:8000/api/accounts/login/ \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'

# Send test notification
curl -X POST http://localhost:8000/api/fcm/test/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{"title":"Test","body":"Hello from FCM"}'
```

### Test on Device

1. Build and run the app on a physical device (emulators don't receive FCM)
2. Login to register the FCM token
3. Login as another user on a different device
4. Send a message while the first device is in background
5. Verify push notification appears

## Troubleshooting

### No Notifications Received

1. Check Firebase console for delivery status
2. Verify FCM token is registered: `GET /api/fcm/list/`
3. Check backend logs for FCM errors
4. Ensure device has internet connectivity

### Invalid Token Errors

- Tokens can expire or become invalid when app is reinstalled
- The backend automatically marks invalid tokens as inactive
- Re-login to register a new token

### iOS Specific

- Ensure APNs certificates are configured in Firebase
- Check Push Notifications capability is enabled in Xcode
- Test on physical device (simulators have limited push support)

### Android Specific

- Verify google-services.json is in correct location
- Check package name matches in Firebase and app
- Ensure Google Play Services is installed on device

## Production Considerations

1. **Token Management**: Implement periodic token refresh
2. **Notification Channels** (Android): Create channels for different notification types
3. **Badge Count**: Update app icon badge for unread messages
4. **Deep Linking**: Configure deep links for notification navigation
5. **Analytics**: Track notification delivery and open rates
6. **Rate Limiting**: Implement rate limiting for notifications

## Security

- FCM tokens are tied to authenticated users via JWT
- Only active devices receive notifications
- Invalid tokens are automatically deactivated
- Users can unregister devices on logout
