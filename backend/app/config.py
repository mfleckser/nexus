import os
from pathlib import Path

from dotenv import load_dotenv

# The one place .env is read. Real environment variables take precedence.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")


class ConfigError(RuntimeError):
    pass


def env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


def env_list(name: str) -> list[str]:
    """Comma-separated env var as a list, blanks dropped."""
    return [item.strip() for item in os.getenv(name, "").split(",") if item.strip()]


# NEXUS_DEBUG=1 turns on Flask's debugger and auto-reloader (off by default).
DEBUG = env_flag("NEXUS_DEBUG")


def port() -> int:
    value = os.getenv("NEXUS_PORT", "5000")
    try:
        return int(value)
    except ValueError:
        raise ConfigError(f"NEXUS_PORT must be a port number, got {value!r}") from None


def supabase_credentials() -> tuple[str, str]:
    missing = [name for name in ("SUPABASE_URL", "SUPABASE_KEY") if not os.getenv(name)]
    if missing:
        raise ConfigError(
            f"missing environment variable(s): {', '.join(missing)}. "
            "Set them in backend/.env (Supabase dashboard -> Project Settings -> API)."
        )
    return os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"]


def api_token() -> str:
    token = os.getenv("NEXUS_API_TOKEN", "").strip()
    if not token:
        raise ConfigError(
            "missing environment variable: NEXUS_API_TOKEN. Set it in backend/.env "
            '(generate one with: python3 -c "import secrets; print(secrets.token_urlsafe(32))").'
        )
    return token


class Config:
    # Cache config
    CACHE_TYPE = "SimpleCache"
    # Short TTL so writes from outside this process (Supabase Studio, a second
    # backend) show up within a minute; this process's own writes invalidate.
    CACHE_DEFAULT_TIMEOUT = 60

    # Rejecting unknown Host headers blocks DNS-rebinding requests from web
    # pages. NEXUS_TRUSTED_HOSTS adds the names the server is reached by
    # (e.g. the Tailscale name, pi.tailnet-1234.ts.net).
    TRUSTED_HOSTS = ["127.0.0.1", "localhost", *env_list("NEXUS_TRUSTED_HOSTS")]
