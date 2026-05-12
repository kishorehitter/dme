# DME - Backend

Django REST Framework + Django Channels backend for DME.

## Features

- **Email OTP Authentication** - Register and login with email verification
- **JWT Tokens** - Secure API authentication
- **Real-time Messaging** - WebSocket support with Django Channels
- **One-on-One & Group Chats** - Full conversation support
- **Message Reactions** - Emoji reactions to messages
- **Typing Indicators** - Real-time typing status
- **Read Receipts** - Track message read status
- **Media Sharing** - Image, video, audio, document support

## Setup

### Prerequisites

- Python 3.12+
- Virtual environment (`.venv` in project root)

### Installation

1. Activate virtual environment:

   ```bash
   cd C:\Agent\Qwen\.venv\Scripts
   activate.bat
   ```

2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Run migrations:

   ```bash
   python manage.py migrate
   ```

4. Create superuser (optional):

   ```bash
   python manage.py createsuperuser
   ```

5. Run development server:
   ```bash
   python manage.py runserver
   ```

## API Endpoints

### Authentication

| Method | Endpoint                        | Description                  |
| ------ | ------------------------------- | ---------------------------- |
| POST   | `/api/accounts/register/`       | Register new user            |
| POST   | `/api/accounts/login/`          | Login with email/password    |
| POST   | `/api/accounts/logout/`         | Logout (blacklist token)     |
| POST   | `/api/accounts/request-otp/`    | Request OTP for verification |
| POST   | `/api/accounts/verify-otp/`     | Verify OTP and get tokens    |
| POST   | `/api/accounts/token/refresh/`  | Refresh access token         |
| GET    | `/api/accounts/profile/`        | Get current user profile     |
| PUT    | `/api/accounts/profile/update/` | Update profile               |

### Chat

| Method | Endpoint                                  | Description              |
| ------ | ----------------------------------------- | ------------------------ |
| GET    | `/api/chat/conversations/`                | List all conversations   |
| POST   | `/api/chat/conversations/`                | Create new conversation  |
| GET    | `/api/chat/conversations/{id}/`           | Get conversation details |
| GET    | `/api/chat/conversations/{id}/messages/`  | List messages            |
| POST   | `/api/chat/conversations/{id}/messages/`  | Send message             |
| POST   | `/api/chat/conversations/{id}/mark-read/` | Mark messages as read    |
| GET    | `/api/chat/users/search/`                 | Search users             |
| GET    | `/api/chat/users/{id}/chat/`              | Get/create direct chat   |

### WebSocket

Connect to: `ws://localhost:8000/ws/chat/{conversation_id}/`

Send JSON messages:

```json
{
  "type": "message",
  "content": "Hello!",
  "message_type": "text"
}
```

Receive messages:

```json
{
  "type": "message",
  "data": {
    "id": 1,
    "sender": {...},
    "content": "Hello!",
    "created_at": "2024-01-01T00:00:00"
  }
}
```

## Testing with curl

### Register

```bash
curl -X POST http://localhost:8000/api/accounts/register/ \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","password_confirm":"password123","first_name":"Test"}'
```

### Login

```bash
curl -X POST http://localhost:8000/api/accounts/login/ \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

## Admin Panel

Access at: `http://localhost:8000/admin/`
