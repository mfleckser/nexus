from functools import wraps

from flask import Blueprint, request, jsonify

from app.services.event_service import (
    get_events,
    parse_instant,
    create_event,
    update_event,
    delete_event,
    update_occurrence,
    delete_occurrence,
    NotFound,
)

events_bp = Blueprint("events", __name__)


def bad_input_as_http(view):
    """ValueError (bad rrule / scope / timestamp) -> 400, NotFound -> 404."""
    @wraps(view)
    def wrapper(*args, **kwargs):
        try:
            return view(*args, **kwargs)
        except NotFound as e:
            return jsonify({"error": str(e)}), 404
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
    return wrapper


@events_bp.route("/events", methods=["GET"])
def list():
    start = request.args.get("start")
    end = request.args.get("end")

    if not start or not end:
        return jsonify({"error": "start and end query params are required"}), 400

    try:
        start_dt = parse_instant(start)
        end_dt = parse_instant(end)
    except ValueError:
        return jsonify({"error": "start and end must be ISO-8601 timestamps"}), 400

    if start_dt >= end_dt:
        return jsonify({"error": "start must be before end"}), 400

    return get_events(start_dt.isoformat(), end_dt.isoformat())

@events_bp.route("/events", methods=["POST"])
@bad_input_as_http
def create():
    data = request.json

    event = create_event(data)

    return jsonify(event), 201

@events_bp.route("/events/<id>", methods=["PUT"])
@bad_input_as_http
def update(id):
    data = request.json

    return update_event(id, data)

@events_bp.route("/events/<id>", methods=["DELETE"])
def delete(id):
    return delete_event(id)

@events_bp.route("/events/<id>/occurrences/<original_start>", methods=["PUT"])
@bad_input_as_http
def update_occ(id, original_start):
    data = request.json or {}

    return update_occurrence(id, parse_instant(original_start), data)

@events_bp.route("/events/<id>/occurrences/<original_start>", methods=["DELETE"])
@bad_input_as_http
def delete_occ(id, original_start):
    return delete_occurrence(id, parse_instant(original_start), request.args.get("scope"))
