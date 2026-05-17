"""
Django settings for DME backend.

Environments:
  - Local dev  : ENVIRONMENT=development  → SQLite, in-memory channels, local media
  - Production : ENVIRONMENT=production   → PostgreSQL, Redis channels, Cloudinary media

Required environment variables (production):
  SECRET_KEY, DATABASE_URL, REDIS_URL, FIREBASE_CREDENTIALS
  LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
  CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
  ALLOWED_HOSTS, CSRF_TRUSTED_ORIGINS, CORS_ALLOWED_ORIGINS

Install:
  pip install django-environ whitenoise channels channels-redis psycopg2-binary
  pip install firebase-admin djangorestframework djangorestframework-simplejwt
  pip install django-cors-headers cloudinary django-cloudinary-storage dj-database-url
"""

from pathlib import Path
from datetime import timedelta
import environ

# ─── Paths ────────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parent.parent

# ─── Environment ──────────────────────────────────────────────────────────────

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, []),
    CORS_ALLOWED_ORIGINS=(list, []),
    CSRF_TRUSTED_ORIGINS=(list, []),
)

environ.Env.read_env(BASE_DIR / '.env')


# ─── Core ─────────────────────────────────────────────────────────────────────

SECRET_KEY  = env('SECRET_KEY')
DEBUG       = env('DEBUG')
ENVIRONMENT = env('ENVIRONMENT', default='production')

IS_DEVELOPMENT = ENVIRONMENT == 'development'

# ─── Hosts & CSRF ─────────────────────────────────────────────────────────────

ALLOWED_HOSTS        = env.list('ALLOWED_HOSTS')
CSRF_TRUSTED_ORIGINS = env.list('CSRF_TRUSTED_ORIGINS', default=[])

# ─── Installed Apps ───────────────────────────────────────────────────────────
# ORDER MATTERS for cloudinary_storage:
#   cloudinary_storage must come BEFORE django.contrib.staticfiles

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',

    # Cloudinary BEFORE staticfiles (required by django-cloudinary-storage)
    'cloudinary_storage',
    'django.contrib.staticfiles',
    'cloudinary',

    # Third-party
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'channels',

    # Local apps
    'accounts',
    'chat',
    'notifications',
    'calls',
]

# ─── Middleware ───────────────────────────────────────────────────────────────

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',   # serve static files
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',        # before CommonMiddleware
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

# ─── URL / WSGI / ASGI ───────────────────────────────────────────────────────

ROOT_URLCONF     = 'myproject.urls'
WSGI_APPLICATION = 'myproject.wsgi.application'
ASGI_APPLICATION = 'myproject.asgi.application'

# ─── Templates ───────────────────────────────────────────────────────────────

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

if IS_DEVELOPMENT:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }
else:
    import dj_database_url
    DATABASES = {
        'default': dj_database_url.config(
            default=env('DATABASE_URL'),
            conn_max_age=600,
            conn_health_checks=True,   # auto-reconnect dropped Neon connections
            ssl_require=True,          # Neon requires SSL
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

# ─── Static Files (WhiteNoise) ────────────────────────────────────────────────

STATIC_URL  = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

STATICFILES_DIRS = []

STATICFILES_FINDERS = [
    'django.contrib.staticfiles.finders.FileSystemFinder',
    'django.contrib.staticfiles.finders.AppDirectoriesFinder',
]

# Cloudinary credentials — read from env vars (never hardcode)
CLOUDINARY_STORAGE = {
    'CLOUD_NAME': env('CLOUDINARY_CLOUD_NAME'),
    'API_KEY':    env('CLOUDINARY_API_KEY'),
    'API_SECRET': env('CLOUDINARY_API_SECRET'),
}

# Force Cloudinary for media only
DEFAULT_FILE_STORAGE = 'chat.models.UniversalCloudinaryStorage'

STORAGES = {
    'default': {
        'BACKEND': 'chat.models.UniversalCloudinaryStorage',
    },
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.StaticFilesStorage',
    },
}
# Keep for compatibility with older packages like django-cloudinary-storage
STATICFILES_STORAGE = 'whitenoise.storage.StaticFilesStorage'

# Prevent build failure if third-party CSS references missing files (e.g. DRF fonts)
WHITENOISE_MANIFEST_STRICT = False

# Set the MEDIA_URL to point to Cloudinary
# MEDIA_URL = f"https://res.cloudinary.com/{env('CLOUDINARY_CLOUD_NAME')}/"

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
    'UNAUTHENTICATED_USER': None,
}

# ─── JWT ──────────────────────────────────────────────────────────────────────

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME':    timedelta(hours=1),
    'REFRESH_TOKEN_LIFETIME':   timedelta(days=7),
    'ROTATE_REFRESH_TOKENS':    True,
    'BLACKLIST_AFTER_ROTATION': True,
    'ALGORITHM':         'HS256',
    'SIGNING_KEY':       SECRET_KEY,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_TOKEN_CLASSES': ('rest_framework_simplejwt.tokens.AccessToken',),
}

# ─── CORS ─────────────────────────────────────────────────────────────────────

CORS_ALLOW_ALL_ORIGINS = IS_DEVELOPMENT
CORS_ALLOW_CREDENTIALS = True

if not IS_DEVELOPMENT:
    CORS_ALLOWED_ORIGINS = env.list('CORS_ALLOWED_ORIGINS')

# ─── Security Headers (production only) ──────────────────────────────────────

if not IS_DEVELOPMENT:
    SECURE_SSL_REDIRECT            = True
    SECURE_HSTS_SECONDS            = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD            = True

    SESSION_COOKIE_SECURE  = True
    CSRF_COOKIE_SECURE     = True
    SESSION_COOKIE_HTTPONLY = True
    CSRF_COOKIE_HTTPONLY    = True

    X_FRAME_OPTIONS             = 'DENY'
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_BROWSER_XSS_FILTER   = True

    # Required on Render — SSL is terminated at the load balancer
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# ─── Django Channels ──────────────────────────────────────────────────────────

if IS_DEVELOPMENT:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        }
    }
else:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [env('REDIS_URL', default='redis://localhost:6379')],
            },
        }
    }

# ─── Firebase ─────────────────────────────────────────────────────────────────

FIREBASE_CREDENTIALS = env.json('FIREBASE_CREDENTIALS')

# ─── LiveKit ──────────────────────────────────────────────────────────────────

LIVEKIT_URL        = env('LIVEKIT_URL',        default='wss://dme-chat-yanapy2q.livekit.cloud')
LIVEKIT_API_KEY    = env('LIVEKIT_API_KEY')
LIVEKIT_API_SECRET = env('LIVEKIT_API_SECRET')

# ─── Logging ──────────────────────────────────────────────────────────────────

if not IS_DEVELOPMENT:
    LOGGING = {
        'version': 1,
        'disable_existing_loggers': False,
        'formatters': {
            'verbose': {
                'format': '{levelname} {asctime} {module} {message}',
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
