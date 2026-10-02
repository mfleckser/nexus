import sys

from app import create_app
from app.config import DEBUG, ConfigError

try:
    app = create_app()
except ConfigError as e:
    sys.exit(f"Nexus backend: {e}")

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=DEBUG)
