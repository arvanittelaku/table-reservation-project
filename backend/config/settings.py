"""Django settings for the ejaBashkohu backend.

Everything environment-specific comes from environment variables (see
.env.example). The database is the existing Postgres; Django runs every app
request as the signed-in user so the row-level rules in the database apply.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path):
    """Tiny .env reader (KEY=VALUE lines) so local runs need no extra package."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(BASE_DIR / '.env')


def env(name, default=None):
    return os.environ.get(name, default)


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ('1', 'true', 'yes', 'on')


def env_list(name, default=''):
    return [x.strip() for x in os.environ.get(name, default).split(',') if x.strip()]


DEBUG = env_bool('DEBUG', False)
SECRET_KEY = env('DJANGO_SECRET_KEY') or ('dev-insecure-key' if DEBUG else None)
if not SECRET_KEY:
    raise RuntimeError('DJANGO_SECRET_KEY must be set when DEBUG is off')

ALLOWED_HOSTS = env_list('ALLOWED_HOSTS', 'localhost,127.0.0.1')

INSTALLED_APPS = [
    'channels',
    'core',
]

MIDDLEWARE = [
    'core.http.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.middleware.common.CommonMiddleware',
]

ROOT_URLCONF = 'config.urls'
ASGI_APPLICATION = 'config.asgi.application'
TEMPLATES = []

# The existing Postgres (Supabase's database or the local dev copy).
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': env('DB_NAME', 'ejb_dev'),
        'USER': env('DB_USER', 'postgres'),
        'PASSWORD': env('DB_PASSWORD', ''),
        'HOST': env('DB_HOST', '/tmp'),
        'PORT': env('DB_PORT', '54329'),
        'CONN_MAX_AGE': int(env('DB_CONN_MAX_AGE', '60')),
        'OPTIONS': {'sslmode': env('DB_SSLMODE', 'prefer')},
    }
}

REDIS_URL = env('REDIS_URL', 'redis://127.0.0.1:6379/0')
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {'hosts': [REDIS_URL]},
    }
}
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': REDIS_URL,
    }
}

USE_TZ = True
TIME_ZONE = 'UTC'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ───────────── public URLs ─────────────
# Where the web app lives (email links and OAuth return here) and where this
# backend is reachable from browsers.
SITE_URL = env('SITE_URL', 'http://localhost:5173').rstrip('/')
API_URL = env('API_URL', 'http://localhost:8000').rstrip('/')
# Redirect targets accepted from the app (email links, OAuth); others fall back to SITE_URL.
AUTH_REDIRECT_ALLOWLIST = env_list('AUTH_REDIRECT_ALLOWLIST', SITE_URL)
CORS_ALLOWED_ORIGINS = env_list('CORS_ALLOWED_ORIGINS', SITE_URL)

# ───────────── auth ─────────────
JWT_SECRET = env('JWT_SECRET') or SECRET_KEY
JWT_ACCESS_TTL = int(env('JWT_ACCESS_TTL', '3600'))           # 1 hour, like Supabase
REFRESH_TOKEN_TTL_DAYS = int(env('REFRESH_TOKEN_TTL_DAYS', '30'))
AUTH_EMAIL_CONFIRM = env_bool('AUTH_EMAIL_CONFIRM', True)       # require email confirmation
AUTH_LINK_TTL = int(env('AUTH_LINK_TTL', str(24 * 3600)))      # confirmation/reset links
AUTH_MIN_PASSWORD = int(env('AUTH_MIN_PASSWORD', '6'))
AUTH_RATE_LIMIT_PER_MIN = int(env('AUTH_RATE_LIMIT_PER_MIN', '20'))

OAUTH = {
    'google': {
        'client_id': env('GOOGLE_CLIENT_ID', ''),
        'client_secret': env('GOOGLE_CLIENT_SECRET', ''),
        'authorize_url': env('GOOGLE_AUTHORIZE_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
        'token_url': env('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
        'userinfo_url': env('GOOGLE_USERINFO_URL', 'https://openidconnect.googleapis.com/v1/userinfo'),
        'scope': 'openid email profile',
    },
    'apple': {
        'client_id': env('APPLE_CLIENT_ID', ''),          # the Services ID
        'team_id': env('APPLE_TEAM_ID', ''),
        'key_id': env('APPLE_KEY_ID', ''),
        'private_key': env('APPLE_PRIVATE_KEY', '').replace('\\n', '\n'),
        'authorize_url': env('APPLE_AUTHORIZE_URL', 'https://appleid.apple.com/auth/authorize'),
        'token_url': env('APPLE_TOKEN_URL', 'https://appleid.apple.com/auth/token'),
        'jwks_url': env('APPLE_JWKS_URL', 'https://appleid.apple.com/auth/keys'),
        'scope': 'name email',
    },
}

# ───────────── storage ─────────────
STORAGE_ROOT = Path(env('STORAGE_ROOT', str(BASE_DIR / 'var' / 'storage')))
STORAGE_BUCKETS = {
    'avatars': {
        'public': False,
        'max_bytes': 5 * 1024 * 1024,
        'mime_types': ['image/jpeg', 'image/png', 'image/webp'],
    },
}

# ───────────── email ─────────────
EMAIL_BACKEND = env('EMAIL_BACKEND', 'django.core.mail.backends.console.EmailBackend')
EMAIL_FILE_PATH = env('EMAIL_FILE_PATH', str(BASE_DIR / 'var' / 'mail'))
EMAIL_HOST = env('SMTP_HOST', 'smtp.gmail.com')
EMAIL_PORT = int(env('SMTP_PORT', '465'))
EMAIL_HOST_USER = env('SMTP_USER', '')
EMAIL_HOST_PASSWORD = env('SMTP_PASSWORD', '')
EMAIL_USE_SSL = env_bool('SMTP_SSL', EMAIL_PORT == 465)
EMAIL_USE_TLS = env_bool('SMTP_TLS', EMAIL_PORT == 587)
DEFAULT_FROM_EMAIL = env('SMTP_FROM', 'ejaBashkohu <support@ejabashkohu.com>')

# ───────────── safety ─────────────
DATA_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024
SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_SECURE = not DEBUG
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'root': {'handlers': ['console'], 'level': env('LOG_LEVEL', 'INFO')},
    # never log SQL parameters (passwords are checked inside Postgres)
    'loggers': {'django.db.backends': {'level': 'WARNING'}},
}
