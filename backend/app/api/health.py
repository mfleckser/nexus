from flask import Blueprint, current_app, jsonify

from app.extensions.supabase import supabase

health_bp = Blueprint("health", __name__)


@health_bp.route("/health")
def health():
    """Liveness plus a cheap DB round trip."""
    try:
        supabase.table("tasks").select("id").limit(1).execute()
    except Exception:
        current_app.logger.exception("Health check: DB query failed")
        return jsonify({"status": "ok", "db": "error"}), 503
    return jsonify({"status": "ok", "db": "connected"})
