from flask import Flask

from app.config import Config
from app.extensions.cache import cache

from app.api.health import health_bp
from app.api.tasks import tasks_bp
from app.api.events import events_bp
from app.api.projects import projects_bp

def create_app():
    app = Flask(__name__)

    app.config.from_object(Config)

    cache.init_app(app)

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(tasks_bp, url_prefix="/api")
    app.register_blueprint(events_bp, url_prefix="/api")
    app.register_blueprint(projects_bp, url_prefix="/api")

    return app