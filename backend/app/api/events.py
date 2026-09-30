from flask import Blueprint, request, jsonify

from app.services.event_service import (
    get_events,
    parse_instant,
    create_event,
    update_event,
    delete_event
)

events_bp = Blueprint("events", __name__)

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
def create():
    data = request.json

    event = create_event(data)

    return jsonify(event), 201

@events_bp.route("/events/<id>", methods=["PUT"])
def update(id):
    data = request.json

    return update_event(id, data)

@events_bp.route("/events/<id>", methods=["DELETE"])
def delete(id):
    return delete_event(id)
