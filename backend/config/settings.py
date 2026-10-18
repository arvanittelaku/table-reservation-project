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
    'django.contrib.postgres',
    # Django admin at /django-admin/ (core/admin_site.py, ejb/admin.py)
    'django.contrib.admin.apps.SimpleAdminConfig',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'channels',
    'core',
    'ejb',
]

MIDDLEWARE = [
    'core.http.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

if DEBUG or env_bool('PERF_LOG', False):
    MIDDLEWARE.insert(1, 'core.perf.PerfMiddleware')   # per-request time / DB time / query count log

ROOT_URLCONF = 'config.urls'
ASGI_APPLICATION = 'config.asgi.application'
TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [BASE_DIR / 'core' / 'templates'],
    'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.request',
        'django.contrib.auth.context_processors.auth',
        'django.contrib.messages.context_processors.messages',
    ]},
}]

# ───────────── Django admin ─────────────
# Sign-in with Django's own staff users (public.auth_user, `manage.py
# createsuperuser`), never with the app accounts in auth.users. Actions that run
# app server functions act as the app admin with the same email (core/admin_auth.py).
AUTHENTICATION_BACKENDS = ['django.contrib.auth.backends.ModelBackend']
ADMIN_URL = 'django-admin/'
STATIC_URL = '/django-admin/static/'           # admin CSS/JS
# production: `collectstatic` fills this folder (a volume Caddy serves, deploy/);
# the backend's own /django-admin/static/ view stays as a fallback for dev
STATIC_ROOT = Path(env('STATIC_ROOT', str(BASE_DIR / 'var' / 'static')))
SESSION_COOKIE_PATH = '/django-admin/'         # admin cookies never reach the API paths
CSRF_COOKIE_PATH = '/django-admin/'
SESSION_COOKIE_NAME = 'ejb_admin_session'
CSRF_COOKIE_NAME = 'ejb_admin_csrf'
SESSION_COOKIE_AGE = int(env('ADMIN_SESSION_AGE', str(8 * 3600)))
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = 'Lax'

# The existing Postgres (Supabase's database or the local dev copy).
# Connections come from a small pool kept open between requests (psycopg_pool, Django 5.1+):
# opening a new TLS connection to a remote database costs several round trips (hundreds of ms)
# and Supabase's session pooler allows only 15 clients, so the pool stays below that.
# Without psycopg_pool installed (pip install "psycopg[pool]") dev falls back to one
# connection per request, which is slower but never exhausts the limit.
try:
    import psycopg_pool  # noqa: F401
    _HAS_POOL = True
except ImportError:
    _HAS_POOL = False

_DB_OPTIONS = {'sslmode': env('DB_SSLMODE', 'prefer')}
if _HAS_POOL and env_bool('DB_POOL', True):
    _DB_OPTIONS['pool'] = {
        'min_size': int(env('DB_POOL_MIN', '2')),
        'max_size': int(env('DB_POOL_MAX', '10')),
        'timeout': 20,
    }
    _CONN_MAX_AGE = 0                      # Django requires 0 when a pool is configured
else:
    _CONN_MAX_AGE = int(env('DB_CONN_MAX_AGE', '0' if DEBUG else '60'))

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': env('DB_NAME', 'ejb_dev'),
        'USER': env('DB_USER', 'postgres'),
        'PASSWORD': env('DB_PASSWORD', ''),
        'HOST': env('DB_HOST', '/tmp'),
        'PORT': env('DB_PORT', '54329'),
        'CONN_MAX_AGE': _CONN_MAX_AGE,
        'OPTIONS': _DB_OPTIONS,
    }
}

REDIS_URL = env('REDIS_URL', 'redis://127.0.0.1:6379/0')
if DEBUG and not os.environ.get('REDIS_URL'):
    # Local dev without Redis (e.g. Windows): in-process channel layer + cache. Live updates
    # still work inside the single dev server; nothing tries to reach 127.0.0.1:6379, which
    # used to crash every WebSocket and make the browser reconnect in a tight loop.
    CHANNEL_LAYERS = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
    CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
else:
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
# Existing index names (e.g. idx_lesson_participants_student) exceed Django's
# portable 30-char limit; Postgres allows 63, and we keep the live names.
# CSRF middleware (W003) is not used: the API authenticates with bearer tokens
# in the Authorization header, never with cookies, so cross-site forms cannot act.
SILENCED_SYSTEM_CHECKS = ['models.E034', 'security.W003']

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
# local: files under STORAGE_ROOT (a persistent volume). s3: an S3-compatible bucket
# (Cloudflare R2, Hetzner Object Storage, AWS S3, MinIO), see core/storage.py.
STORAGE_BACKEND = env('STORAGE_BACKEND', 'local').strip().lower()
STORAGE_ROOT = Path(env('STORAGE_ROOT', str(BASE_DIR / 'var' / 'storage')))
# R2: https://<account-id>.r2.cloudflarestorage.com, Hetzner: https://<location>.your-objectstorage.com
S3_ENDPOINT_URL = env('S3_ENDPOINT', '') or env('S3_ENDPOINT_URL', '')
S3_BUCKET = env('S3_BUCKET', '')
S3_ACCESS_KEY_ID = env('S3_ACCESS_KEY_ID', '')
S3_SECRET_ACCESS_KEY = env('S3_SECRET_ACCESS_KEY', '')
S3_REGION = env('S3_REGION', 'auto')               # R2: auto; Hetzner: fsn1 / nbg1 / hel1
S3_KEY_PREFIX = env('S3_KEY_PREFIX', '')           # e.g. "prod/" to share a bucket
# presigned: createSignedUrl(s) return presigned GET URLs of the bucket (default);
# redirect: backend /storage/v1/object/sign/... URL that 302s to a fresh presigned URL;
# proxy: backend URL that streams the object (bucket never reachable by clients)
S3_SIGNED_URL_MODE = env('S3_SIGNED_URL_MODE', 'presigned').strip().lower()
S3_PRESIGN_TTL = int(env('S3_PRESIGN_TTL', '3600'))
if S3_SIGNED_URL_MODE not in ('presigned', 'redirect', 'proxy'):
    raise RuntimeError('S3_SIGNED_URL_MODE must be presigned, redirect or proxy')
if STORAGE_BACKEND not in ('local', 's3'):
    raise RuntimeError('STORAGE_BACKEND must be local or s3')
if STORAGE_BACKEND == 's3' and not all([S3_ENDPOINT_URL, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY]):
    raise RuntimeError('STORAGE_BACKEND=s3 needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY')
STORAGE_BUCKETS = {
    'avatars': {
        'public': False,
        'max_bytes': 5 * 1024 * 1024,
        'mime_types': ['image/jpeg', 'image/png', 'image/webp'],
    },
}

# ───────────── video lessons (Jitsi) ─────────────
# Production: 8x8 Jitsi as a Service (JaaS), rooms protected by a JWT per
# participant. JaaS console -> API keys: app id ("vpaas-magic-cookie-..."), the
# key id (kid, "<appId>/<hex>") and the private key (PEM; "\n" escapes allowed).
# VIDEO_PROVIDER: 'jaas' (8x8 JaaS), 'jitsi' (own Jitsi with JWT auth), 'public'
# (open rooms on JITSI_DOMAIN, no tokens: local dev only). Empty = auto: 'jitsi'
# when JITSI_APP_SECRET is set, else 'jaas' when the JAAS_* keys are set, else 'public'.
VIDEO_PROVIDER = env('VIDEO_PROVIDER', '').strip().lower()
JAAS_APP_ID = env('JAAS_APP_ID', '')
JAAS_API_KEY_ID = env('JAAS_API_KEY_ID', '') or env('JAAS_KEY_ID', '')   # JAAS_KEY_ID: old name
JAAS_KEY_ID = JAAS_API_KEY_ID
JAAS_PRIVATE_KEY = env('JAAS_PRIVATE_KEY', '').replace('\\n', '\n')
if not JAAS_PRIVATE_KEY and env('JAAS_PRIVATE_KEY_FILE'):     # or mount the .pk file
    JAAS_PRIVATE_KEY = Path(env('JAAS_PRIVATE_KEY_FILE')).read_text()
JAAS_DOMAIN = env('JAAS_DOMAIN', '8x8.vc')
# Self-hosted Jitsi (deploy/docker-compose.jitsi.yml) with JWT auth: rooms only
# open with an HS256 token signed by JITSI_APP_SECRET (= the server's
# JWT_APP_SECRET). Takes precedence over JaaS. With JITSI_APP_SECRET empty and
# no JaaS: plain open rooms on JITSI_DOMAIN (meet.jit.si for local dev), as before.
JITSI_DOMAIN = env('JITSI_DOMAIN', 'meet.jit.si')
JITSI_APP_ID = env('JITSI_APP_ID', 'ejabashkohu')
JITSI_APP_SECRET = env('JITSI_APP_SECRET', '')

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
CSRF_COOKIE_SECURE = not DEBUG
# behind Caddy/HTTPS: the admin forms post from API_URL (Origin check)
CSRF_TRUSTED_ORIGINS = env_list('CSRF_TRUSTED_ORIGINS', API_URL)
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = env_bool('SECURE_SSL_REDIRECT', True)
    SECURE_REDIRECT_EXEMPT = [r'^health$']          # platform health checks over plain HTTP
    SECURE_HSTS_SECONDS = int(env('SECURE_HSTS_SECONDS', str(30 * 24 * 3600)))
    if not env('JWT_SECRET'):
        raise RuntimeError('JWT_SECRET must be set when DEBUG is off')

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'root': {'handlers': ['console'], 'level': env('LOG_LEVEL', 'INFO')},
    # never log SQL parameters (passwords are checked inside Postgres)
    'loggers': {'django.db.backends': {'level': 'WARNING'}},
}
