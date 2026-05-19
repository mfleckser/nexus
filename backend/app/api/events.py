from flask import Blueprint, request, jsonify

from app.services.event_service import (
    get_all_events,
    create_event
)

events_bp = Blueprint("events", __name__)

@events_bp.route("/events", methods=["GET"])
def list():
    return get_all_events()

@events_bp.route("/events", methods=["POST"])
def create():
    data = request.data

    event = create_event(data)

    return jsonify(event), 201
