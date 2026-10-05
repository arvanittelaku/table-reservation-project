"""Small helpers the app (or policies) call directly."""
from uuid import UUID

from ..models import Profile
from ..policies import my_hosted_table_ids, my_table_ids, viewer_home_city, viewer_sees_all_cities
from ..rpc import rpc
from . import common
from .. import context


@rpc('is_admin_user', anon=True)
def is_admin_user() -> bool:
    return common.is_admin()


@rpc('is_premium')
def is_premium(p_user: UUID) -> bool:
    return common.is_premium(p_user)


@rpc('can_see_city')
def can_see_city(p_city: str) -> bool:
    u = context.uid()
    return u is not None and (common.is_premium(u)
                              or Profile.objects.filter(pk=u, home_city=p_city).exists())


@rpc('_viewer_sees_all_cities', anon=True)
def _viewer_sees_all_cities() -> bool:
    return viewer_sees_all_cities(context.actor())


@rpc('_viewer_home_city', anon=True)
def _viewer_home_city() -> str:
    return viewer_home_city(context.actor())


@rpc('_my_table_ids', anon=True)
def _my_table_ids() -> list:
    return sorted(my_table_ids(context.actor()), key=str)


@rpc('_my_hosted_table_ids', anon=True)
def _my_hosted_table_ids() -> list:
    return my_hosted_table_ids(context.actor())
