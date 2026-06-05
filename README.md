# DME

A full-stack DME application with React Native frontend and Django REST Framework + Django Channels backend.

## Features

### Authentication

- ✅ Email-based registration with OTP verification
- ✅ JWT token authentication
- ✅ Secure password handling
- ✅ Auto-login with token persistence
- ✅ Delete account functionality

### Messaging & Calls

- ✅ Real-time messaging with WebSocket (Django Channels)
- ✅ One-on-one and Group calling functionality
- ✅ Call history with clear/delete options
- ✅ One-on-one conversations
- ✅ Group chat support
- ✅ Message status (sent, delivered, read)
- ✅ Typing indicators
- ✅ Read receipts

### UI/UX

- ✅ Modern UI with clean color scheme
- ✅ Message bubbles with timestamps
- ✅ Unread message badges
- ✅ Conversation list with last message preview
- ✅ User search for new conversations
- ✅ Modern popover menus for options

## Tech Stack

### Backend (Django)

- Django 4.2
- Django REST Framework
- Django Channels (WebSocket)
- JWT Authentication
- SQLite (development) / PostgreSQL (production)
- Redis (for Channels in production)

### Frontend (React Native)

- React Native 0.74 (DME)
- TypeScript
- React Navigation
- Axios
- WebSocket
- AsyncStorage

## Project Structure

```
C:\Dev\AndroidApp\
├── backend/              # Django backend
│   ├── accounts/         # User authentication app
│   ├── chat/             # Chat and messaging app
│   ├── calls/            # Calls app
│   ├── myproject/        # Django project settings
│   ├── manage.py
│   └── requirements.txt
│
├── DME/                  # React Native app
│   ├── src/
│   │   ├── components/   # Reusable components
│   │   ├── context/      # React Context
│   │   ├── navigation/   # Navigation config
│   │   ├── screens/      # Screen components
│   │   ├── services/     # API & WebSocket
│   │   ├── types/        # TypeScript types
│   │   └── utils/        # Utilities & theme
│   ├── App.tsx
│   └── package.json
│
└── .venv/                # Python virtual environment
```

## Quick Start

### 1. Start Backend

```bash
# Activate virtual environment
.venv\Scripts\activate

# Navigate to backend
cd backend

# Run Django server
python manage.py runserver
```

### 2. Start Frontend

```bash
# Navigate to frontend
cd DME

# Install dependencies
npm install

# Start Metro bundler
npm start

# Run on Android
npm run android
```

## API Endpoints

### Authentication

| Method | Endpoint                        | Description       |
| ------ | ------------------------------- | ----------------- |
| POST   | `/api/accounts/register/`       | Register new user |
| POST   | `/api/accounts/login/`          | Login             |
| POST   | `/api/accounts/logout/`         | Logout            |
| DELETE | `/api/accounts/delete-account/` | Delete account    |
| POST   | `/api/accounts/request-otp/`    | Request OTP       |
| POST   | `/api/accounts/verify-otp/`     | Verify OTP        |
| GET    | `/api/accounts/profile/`        | Get profile       |
| PUT    | `/api/accounts/profile/update/` | Update profile    |

### Chat

| Method | Endpoint                                  | Description         |
| ------ | ----------------------------------------- | ------------------- |
| GET    | `/api/chat/conversations/`                | List conversations  |
| POST   | `/api/chat/conversations/`                | Create conversation |
| GET    | `/api/chat/conversations/{id}/messages/`  | Get messages        |
| POST   | `/api/chat/conversations/{id}/messages/`  | Send message        |
| POST   | `/api/chat/conversations/{id}/mark-read/` | Mark as read        |
| GET    | `/api/chat/users/search/`                 | Search users        |

## Configuration

### Backend (.env)

```env
SECRET_KEY=your-secret-key
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=http://localhost:8081,http://localhost:19006
```

### Frontend (src/services/api.ts)

```typescript
// Android emulator
const API_BASE_URL = "http://10.0.2.2:8000/api";

// iOS simulator
// const API_BASE_URL = 'http://localhost:8000/api';

// Physical device
// const API_BASE_URL = 'http://192.168.1.100:8000/api';
```

## Testing

### Using curl

**Register:**

```bash
curl -X POST http://localhost:8000/api/accounts/register/ \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","password_confirm":"password123","first_name":"Test"}'
```

**Login:**

```bash
curl -X POST http://localhost:8000/api/accounts/login/ \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

**Get Conversations:**

```bash
curl -X GET http://localhost:8000/api/chat/conversations/ \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Production Deployment

### Backend

1. Set `DEBUG=False`
2. Use PostgreSQL instead of SQLite
3. Configure Redis for Channels
4. Set up proper email SMTP for OTP
5. Deploy to Heroku, AWS, or similar

### Frontend

1. Update API URLs to production server
2. Build release APK/IPA
3. Publish to app stores

## Troubleshooting

### Backend Issues

- **Migration errors**: Delete `db.sqlite3` and run `python manage.py migrate`
- **CORS errors**: Add your frontend URL to `CORS_ALLOWED_ORIGINS`
- **WebSocket not connecting**: Check `CHANNEL_LAYERS` in settings

### Frontend Issues

- **Network errors**: Update API_BASE_URL to match your setup
- **WebSocket not connecting**: Ensure backend is running and URL is correct
- **Build errors**: Run `npm install` again

## License

MIT
