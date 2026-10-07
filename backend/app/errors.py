"""App exceptions and the handlers that turn every error into a JSON body
of the form {"error": "<message>"} (never an HTML error page)."""

from flask import Flask, jsonify
from supabase import PostgrestAPIError as APIError
from werkzeug.exceptions import HTTPException


class AppError(Exception):
    status = 500

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class ValidationError(AppError, ValueError):
    """Bad client input -> 400. Subclasses ValueError so pure helpers (e.g.
    recurrence) can raise it without depending on Flask."""

    status = 400


class NotFound(AppError, LookupError):
    status = 404


def first_row(data: list, what: str) -> dict:
    """First row of a PostgREST result, or NotFound when there is none (an
    update/delete/select by id that matched nothing)."""
    if not data:
        raise NotFound(f"{what} not found")
    return data[0]


def _error(message: str, status: int):
    return jsonify({"error": message}), status


def _is_client_error(code) -> bool:
    # Postgres SQLSTATE class 22 = data exception (e.g. 22P02 invalid uuid
    # text), class 23 = integrity constraint violation (not null, FK, check,
    # unique). Both mean the request carried bad values.
    return isinstance(code, str) and code[:2] in ("22", "23")


def register_error_handlers(app: Flask):
    @app.errorhandler(AppError)
    def app_error(e: AppError):
        return _error(e.message, e.status)

    @app.errorhandler(APIError)
    def postgrest_error(e: APIError):
        if _is_client_error(e.code):
            return _error(e.message or "invalid request", 400)
        app.logger.exception("PostgREST error")
        return _error("Database error", 500)

    @app.errorhandler(HTTPException)
    def http_error(e: HTTPException):
        return _error(e.description, e.code)

    @app.errorhandler(Exception)
    def unhandled(e: Exception):
        app.logger.exception("Unhandled exception")
        return _error("Internal server error", 500)
