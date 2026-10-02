"""Request-body helpers shared by the blueprints and services.

Field checks take the dict of fields a request is setting and only look at
the ones present, so the same checks serve creates and partial updates."""

from datetime import UTC, datetime

from flask import request

from app.errors import ValidationError
from app.services.recurrence import get_zone


def json_body() -> dict:
    """The request's JSON object body; 400 if it is missing, malformed or not
    an object."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValidationError("request body must be a JSON object")
    return data


def parse_instant(value: str) -> datetime:
    """Parse an ISO-8601 instant and normalize to UTC, so that two spellings of
    the same moment share one cache entry. Raises ValidationError if unparseable."""
    try:
        dt = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValidationError(f"invalid ISO-8601 timestamp: {value!r}") from None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def pick(data: dict, names) -> dict:
    """The whitelisted fields present in data."""
    return {n: data[n] for n in names if n in data}


def require(data: dict, *names):
    missing = [n for n in names if n not in data]
    if missing:
        raise ValidationError(f"missing required field(s): {', '.join(missing)}")


def _check(fields: dict, name: str, nullable: bool, valid, expected: str):
    if name not in fields:
        return
    value = fields[name]
    if value is None:
        if not nullable:
            raise ValidationError(f"{name} cannot be null")
    elif not valid(value):
        raise ValidationError(f"{name} must be {expected}")


def check_text(fields: dict, name: str, nullable: bool = True):
    _check(fields, name, nullable, lambda v: isinstance(v, str), "a string")


def check_title(fields: dict, name: str = "title"):
    """A NOT NULL display name: a string with something other than whitespace."""
    _check(fields, name, False, lambda v: isinstance(v, str) and v.strip(), "a non-empty string")


def check_bool(fields: dict, name: str, nullable: bool = True):
    _check(fields, name, nullable, lambda v: isinstance(v, bool), "a boolean")


def _is_instant(value) -> bool:
    try:
        parse_instant(value)
    except ValidationError:
        return False
    return True


def check_instant(fields: dict, name: str, nullable: bool = True):
    _check(fields, name, nullable, _is_instant, "an ISO-8601 timestamp")


def check_choice(fields: dict, name: str, choices, nullable: bool = False):
    _check(fields, name, nullable, lambda v: v in choices, f"one of {', '.join(choices)}")


def _is_zone(value) -> bool:
    try:
        get_zone(value)
    except ValidationError:
        return False
    return True


def check_timezone(fields: dict, name: str = "timezone"):
    _check(fields, name, False, _is_zone, "an IANA timezone name")
