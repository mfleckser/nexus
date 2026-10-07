from flask import Flask

from app.config import Config
from app.errors import register_error_handlers
from app.extensions.cache import cache


def create_app():
    # Imported here so that importing the package (e.g. app.config) doesn't
    # build the Supabase client; a missing credential surfaces as ConfigError
    # from create_app().
    from app.api.events import events_bp
    from app.api.health import health_bp
    from app.api.projects import projects_bp
    from app.api.tasks import tasks_bp

    app = Flask(__name__)

    app.config.from_object(Config)

    cache.init_app(app)
    register_error_handlers(app)

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(tasks_bp, url_prefix="/api")
    app.register_blueprint(events_bp, url_prefix="/api")
    app.register_blueprint(projects_bp, url_prefix="/api")

    return app
