from flask import Blueprint, request, jsonify

from app.services.event_service import (
    get_all_events,
    create_event,
    update_event,
    delete_event
)

events_bp = Blueprint("events", __name__)

@events_bp.route("/events", methods=["GET"])
def list():
    return get_all_events()

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
