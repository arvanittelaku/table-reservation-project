from django.apps import AppConfig


class EjbConfig(AppConfig):
    name = 'ejb'
    verbose_name = 'ejaBashkohu'
    default_auto_field = 'django.db.models.BigAutoField'

    def ready(self):
        from . import signals  # noqa: F401  (model hooks that replaced the database triggers)
        from . import services  # noqa: F401  (registers the server functions)
