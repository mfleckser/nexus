from flask import Blueprint, jsonify, request

from app.errors import ValidationError
from app.services.event_service import (
    create_event,
    delete_event,
    delete_occurrence,
    get_events,
    parse_instant,
    update_event,
    update_occurrence,
)
from app.validation import json_body

events_bp = Blueprint("events", __name__)


@events_bp.route("/events", methods=["GET"])
def list():
    start = request.args.get("start")
    end = request.args.get("end")

    if not start or not end:
        raise ValidationError("start and end query params are required")

    try:
        start_dt = parse_instant(start)
        end_dt = parse_instant(end)
    except ValidationError:
        raise ValidationError("start and end must be ISO-8601 timestamps") from None

    if start_dt >= end_dt:
        raise ValidationError("start must be before end")

    return get_events(start_dt.isoformat(), end_dt.isoformat())


@events_bp.route("/events", methods=["POST"])
def create():
    event = create_event(json_body())

    return jsonify(event), 201


@events_bp.route("/events/<id>", methods=["PUT"])
def update(id):
    return update_event(id, json_body())


@events_bp.route("/events/<id>", methods=["DELETE"])
def delete(id):
    return delete_event(id)


@events_bp.route("/events/<id>/occurrences/<original_start>", methods=["PUT"])
def update_occ(id, original_start):
    return update_occurrence(id, parse_instant(original_start), json_body())


@events_bp.route("/events/<id>/occurrences/<original_start>", methods=["DELETE"])
def delete_occ(id, original_start):
    return delete_occurrence(id, parse_instant(original_start), request.args.get("scope"))
