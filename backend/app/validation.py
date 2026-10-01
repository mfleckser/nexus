"""Request-body helpers shared by the blueprints and services."""

from flask import request

from app.errors import ValidationError


def json_body() -> dict:
    """The request's JSON object body; 400 if it is missing, malformed or not
    an object."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValidationError("request body must be a JSON object")
    return data
