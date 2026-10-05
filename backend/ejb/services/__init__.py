"""The app's server functions (what the SQL functions behind /rest/v1/rpc did).

Each module registers functions with @rpc; names, argument names and result
shapes are unchanged, so the web app calls them exactly as before.
"""
import importlib
import pkgutil

for _m in pkgutil.iter_modules(__path__):
    if _m.name != 'common':
        importlib.import_module(f'{__name__}.{_m.name}')
