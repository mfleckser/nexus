from flask import Blueprint, Flask

from app.auth import require_api_token
from app.config import Config, api_token
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
    require_api_token(app, api_token())

    api = Blueprint("api", __name__)
    for bp in (health_bp, tasks_bp, events_bp, projects_bp):
        api.register_blueprint(bp)
    # /api serves the same routes unversioned, for clients that predate v1.
    # Keep backend/openapi.json in step with every route (tests/test_openapi.py).
    app.register_blueprint(api, url_prefix="/api/v1", name="v1")
    app.register_blueprint(api, url_prefix="/api", name="legacy")

    return app
