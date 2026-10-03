from django.urls import path

from core import views_auth as auth
from core import views_data as data

urlpatterns = [
    path('health', data.health),
    # auth (was Supabase Auth)
    path('auth/v1/signup', auth.signup),
    path('auth/v1/token', auth.token),
    path('auth/v1/logout', auth.logout),
    path('auth/v1/user', auth.user),
    path('auth/v1/recover', auth.recover),
    path('auth/v1/resend', auth.resend),
    path('auth/v1/verify', auth.verify),
    path('auth/v1/settings', auth.auth_settings),
    path('auth/v1/authorize', auth.authorize),
    path('auth/v1/callback', auth.callback),
    # data (was PostgREST)
    path('rest/v1/query', data.table_query),
    path('rest/v1/rpc/<str:name>', data.rpc_call),
    # storage (was Supabase Storage)
    path('storage/v1/object/sign/<str:bucket>', data.storage_sign),
    path('storage/v1/object/sign/<str:bucket>/<path:path>', data.storage_signed_get),
    path('storage/v1/object/<str:bucket>', data.storage_object),
    path('storage/v1/object/<str:bucket>/<path:path>', data.storage_object),
    # server functions (were Edge Functions)
    path('functions/v1/<str:name>', data.function_call),
]
