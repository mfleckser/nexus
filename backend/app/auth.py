"""Bearer-token gate: every request needs `Authorization: Bearer <NEXUS_API_TOKEN>`,
except the health check (left open for uptime monitors)."""

import hmac

from flask import Flask, request

from app.errors import Unauthorized

# Endpoint names without the API-version prefix ("v1.", "legacy.").
PUBLIC_ENDPOINTS = {"health.health"}


def require_api_token(app: Flask, token: str):
    expected = f"Bearer {token}".encode()

    @app.before_request
    def check_token():
        if request.endpoint and request.endpoint.split(".", 1)[-1] in PUBLIC_ENDPOINTS:
            return
        given = request.headers.get("Authorization", "").encode()
        if not hmac.compare_digest(given, expected):
            raise Unauthorized("missing or invalid API token")
