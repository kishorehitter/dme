"""
Django settings for DME backend.

Environments:
  - Local dev  : python manage.py runserver  → SQLite, console email, in-memory channels
  - Production : Render / any server         → PostgreSQL, SMTP email, Redis channels

All secrets come from environment variables — never hardcode them.
Install requirements:
  pip install django-environ whitenoise channels channels-redis psycopg2-binary
  pip install firebase-admin djangorestframework djangorestframework-simplejwt django-cors-headers
"""

from logging import config
from pathlib import Path
from datetime import timedelta
import dj_database_url
import os

import environ

# ─── Paths ────────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parent.parent

# ─── Environment ──────────────────────────────────────────────────────────────

env = environ.Env(
    DEBUG=(bool, False),          # default False — must explicitly set DEBUG=True in dev
    ALLOWED_HOSTS=(list, []),
    CORS_ALLOWED_ORIGINS=(list, []),
)

# Read .env file if it exists (local dev convenience)
environ.Env.read_env(BASE_DIR / '.env')


# ─── Core ─────────────────────────────────────────────────────────────────────

SECRET_KEY = env('SECRET_KEY')           # required — no default, crashes if missing
DEBUG       = env('DEBUG')               # False in production
ENVIRONMENT = env('ENVIRONMENT', default='production')  # 'development' | 'production'

IS_DEVELOPMENT = ENVIRONMENT == 'development'

# ─── Hosts & CSRF ─────────────────────────────────────────────────────────────

# Never use ['*'] in production — enumerate your actual domains
ALLOWED_HOSTS = env.list('ALLOWED_HOSTS')
# e.g. ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com,yourapp.onrender.com

# Required in Django 4+ when DEBUG=False and you accept POST requests
CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=[])
# e.g. CSRF_TRUSTED_ORIGINS=https://yourdomain.com,https://yourapp.onrender.com

# ─── Application definition ───────────────────────────────────────────────────

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third-party
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',  # required for BLACKLIST_AFTER_ROTATION
    'corsheaders',
    'channels',

    # Local
    'accounts',
    'chat',
    'notifications',
    'calls',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',        # must be before CommonMiddleware
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF    = 'myproject.urls'
WSGI_APPLICATION = 'myproject.wsgi.application'
ASGI_APPLICATION = 'myproject.asgi.application'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

# ─── Database ─────────────────────────────────────────────────────────────────

# ─── Database ─────────────────────────────────────────────────────────────────
if DEBUG:
    # Local development – SQLite
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }
else:
    # Production – PostgreSQL via DATABASE_URL
    import dj_database_url
    DATABASES = {
        'default': dj_database_url.config(
            default=env('DATABASE_URL'),   # must be set in production
            conn_max_age=600,
        )
    }
# ─── Custom User Model ────────────────────────────────────────────────────────

AUTH_USER_MODEL = 'accounts.User'

# ─── Password Validation ──────────────────────────────────────────────────────

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ─── Internationalisation ─────────────────────────────────────────────────────

LANGUAGE_CODE = 'en-us'
TIME_ZONE     = 'UTC'
USE_I18N      = True
USE_TZ        = True

# ─── Static & Media ───────────────────────────────────────────────────────────

STATIC_URL  = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# WhiteNoise compression — serves static files efficiently without a CDN
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

MEDIA_URL  = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# ─── Default PK ───────────────────────────────────────────────────────────────

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ─── REST Framework ───────────────────────────────────────────────────────────

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    # Return 404 instead of 403 for unauthenticated requests (security best practice)
    'UNAUTHENTICATED_USER': None,
}

# ─── JWT ──────────────────────────────────────────────────────────────────────

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME':  timedelta(minutes=60),   # short — was 1 day (too long)
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS':  True,
    'BLACKLIST_AFTER_ROTATION': True,
    'ALGORITHM':    'HS256',
    'SIGNING_KEY':  SECRET_KEY,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_TOKEN_CLASSES': ('rest_framework_simplejwt.tokens.AccessToken',),
}

# ─── CORS ─────────────────────────────────────────────────────────────────────

# Never allow all origins in production — explicitly list your frontend domains
CORS_ALLOW_ALL_ORIGINS  = IS_DEVELOPMENT   # True only in local dev
CORS_ALLOW_CREDENTIALS  = True

if not IS_DEVELOPMENT:
    CORS_ALLOWED_ORIGINS = env.list('CORS_ALLOWED_ORIGINS')
    # e.g. CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# ─── Security Headers (production only) ──────────────────────────────────────

if not IS_DEVELOPMENT:
    # HTTPS enforcement
    SECURE_SSL_REDIRECT           = True
    SECURE_HSTS_SECONDS           = 31536000  # 1 year
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD           = True

    # Cookie security
    SESSION_COOKIE_SECURE   = True
    CSRF_COOKIE_SECURE      = True
    SESSION_COOKIE_HTTPONLY = True
    CSRF_COOKIE_HTTPONLY    = True

    # Clickjacking / content-sniffing
    X_FRAME_OPTIONS            = 'DENY'
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_BROWSER_XSS_FILTER  = True

    # Proxy awareness (required on Render / Heroku — they terminate SSL at the LB)
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# ─── Django Channels ──────────────────────────────────────────────────────────

if IS_DEVELOPMENT:
    # Local dev — in-memory is fine for a single process
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        }
    }
else:
    # Production — Redis is required (InMemoryChannelLayer does not work across
    # multiple processes / workers and loses all state on restart)
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [env('REDIS_URL', default='redis://localhost:6379')],
            },
        }
    }

# ─── Email ────────────────────────────────────────────────────────────────────

# if IS_DEVELOPMENT:
#     EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
# else:
#     EMAIL_BACKEND    = 'django.core.mail.backends.smtp.EmailBackend'
#     EMAIL_HOST       = env('EMAIL_HOST')
#     EMAIL_PORT       = env.int('EMAIL_PORT', default=587)
#     EMAIL_USE_TLS    = env.bool('EMAIL_USE_TLS', default=True)
#     EMAIL_HOST_USER  = env('EMAIL_HOST_USER')
#     EMAIL_HOST_PASSWORD = env('EMAIL_HOST_PASSWORD')

# DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL', default='DME <noreply@yourdomain.com>')

# # ─── OTP ──────────────────────────────────────────────────────────────────────

# OTP_EXPIRY_MINUTES = env.int('OTP_EXPIRY_MINUTES', default=10)
# OTP_LENGTH         = env.int('OTP_LENGTH', default=6)

# ─── Firebase ─────────────────────────────────────────────────────────────────

FIREBASE_CREDENTIALS = env.json('FIREBASE_CREDENTIALS')

# ─── Logging (production) ─────────────────────────────────────────────────────

if not IS_DEVELOPMENT:
    LOGGING = {
        'version': 1,
        'disable_existing_loggers': False,
        'formatters': {
            'verbose': {
                'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
                'style': '{',
            },
        },
        'handlers': {
            'console': {
                'class': 'logging.StreamHandler',
                'formatter': 'verbose',
            },
        },
        'root': {
            'handlers': ['console'],
            'level': 'WARNING',
        },
        'loggers': {
            'django': {
                'handlers': ['console'],
                'level': 'WARNING',
                'propagate': False,
            },
            'django.request': {
                'handlers': ['console'],
                'level': 'ERROR',
                'propagate': False,
            },
        },
    }



LIVEKIT_URL=env('LIVEKIT_URL', default='wss://dme-chat-yanapy2q.livekit.cloud')
LIVEKIT_API_KEY=env('LIVEKIT_API_KEY')
LIVEKIT_API_SECRET=env('LIVEKIT_API_SECRET') 