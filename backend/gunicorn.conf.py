"""gunicorn settings for the always-on backend (run via backend/serve)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.config import port  # noqa: E402

# Localhost only: off-machine clients come in through `tailscale serve` (HTTPS).
bind = f"127.0.0.1:{port()}"

# One process on purpose: the read cache and its invalidation live in-process,
# so a second worker would keep serving rows the first one's writes changed.
# Threads give the concurrency instead.
workers = 1
threads = 8

# Request lines to stdout (journald under systemd); errors go to stderr.
accesslog = "-"
