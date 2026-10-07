import os
from pathlib import Path

from dotenv import load_dotenv

# The one place .env is read. Real environment variables take precedence.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")


class ConfigError(RuntimeError):
    pass


def env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


# NEXUS_DEBUG=1 turns on Flask's debugger and auto-reloader (off by default).
DEBUG = env_flag("NEXUS_DEBUG")


def supabase_credentials() -> tuple[str, str]:
    missing = [name for name in ("SUPABASE_URL", "SUPABASE_KEY") if not os.getenv(name)]
    if missing:
        raise ConfigError(
            f"missing environment variable(s): {', '.join(missing)}. "
            "Set them in backend/.env (Supabase dashboard -> Project Settings -> API)."
        )
    return os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"]


class Config:
    # Cache config
    CACHE_TYPE = "SimpleCache"
    CACHE_DEFAULT_TIMEOUT = 3600

    # Only the local Electron app talks to this server; rejecting other Host
    # headers blocks DNS-rebinding requests from web pages.
    TRUSTED_HOSTS = ["127.0.0.1", "localhost"]
