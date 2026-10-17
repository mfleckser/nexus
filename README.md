# Nexus

Personal life-system desktop app: calendar, tasks, projects (habits, goals and an AI
coach later). Electron + React frontend, Flask backend, Postgres on Supabase.

## Setup

Backend (Python 3.12, see `backend/.python-version`):

```sh
cd backend
python -m venv venv
venv/bin/pip install -r requirements-dev.txt
cp .env.example .env   # fill in SUPABASE_URL / SUPABASE_KEY / NEXUS_API_TOKEN
```

Frontend:

```sh
cd frontend
npm install
cp .env.example .env   # MAIN_VITE_NEXUS_API_TOKEN = backend's NEXUS_API_TOKEN
```

## Run

```sh
backend/start            # API on http://127.0.0.1:5000 (NEXUS_DEBUG=1 for reloader)
cd frontend && npm run dev
```

The frontend's main process calls the backend at `MAIN_VITE_NEXUS_API_URL` from
`frontend/.env` (default `http://127.0.0.1:5000`) with the bearer token
`MAIN_VITE_NEXUS_API_TOKEN`; both are baked in at build time, so rebuild after changing
them. Every route except `/api/health` needs the token. On macOS, port 5000 can clash
with AirPlay Receiver (System Settings → General → AirDrop & Handoff); set `NEXUS_PORT`
to move it.

## Deploy (Raspberry Pi + Tailscale)

The always-on backend runs under gunicorn (`backend/serve`: one worker, eight threads,
bound to `127.0.0.1`), and `tailscale serve` puts HTTPS in front of it on the tailnet
only. Needs Python 3.11+ and Tailscale on the Pi, with MagicDNS and HTTPS certificates
enabled in the Tailscale admin console (DNS page).

```sh
git clone <repo-url> ~/nexus && cd ~/nexus/backend
python3 -m venv venv
venv/bin/pip install -r requirements.txt
cp .env.example .env   # secret Supabase key, NEXUS_API_TOKEN,
                       # NEXUS_TRUSTED_HOSTS=<pi-name>.<tailnet>.ts.net
./serve                # quick check, then Ctrl-C

# Run at boot (systemd user unit; steps also in the unit file)
mkdir -p ~/.config/systemd/user
cp deploy/nexus-backend.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now nexus-backend
sudo loginctl enable-linger "$USER"

# HTTPS on the tailnet -> 127.0.0.1:5000 (persists across reboots)
sudo tailscale serve --bg 5000
curl https://<pi-name>.<tailnet>.ts.net/api/health
```

Then set `MAIN_VITE_NEXUS_API_URL=https://<pi-name>.<tailnet>.ts.net` in
`frontend/.env` and rebuild. Logs: `journalctl --user -u nexus-backend -f`. Update:
`git pull && venv/bin/pip install -r requirements.txt && systemctl --user restart
nexus-backend`.

## Build

```sh
cd frontend
npm run build          # typecheck + electron-vite build into out/
npm run build:mac      # build + package the app with electron-builder into dist/
npm run build:unpack   # build + unpacked app only (quick local check)
```

`build:win` and `build:linux` package for those platforms.

## Test and lint

```sh
cd backend
venv/bin/python -m unittest discover -s tests
venv/bin/ruff check . && venv/bin/ruff format --check .

cd frontend
npm run typecheck && npm run lint && npm test
```

## Database

Schema lives in raw SQL migrations under `backend/supabase/migrations`. Apply with the
Supabase CLI from `backend/`:

```sh
supabase migration new <name>
supabase db push
```

See `CLAUDE.md` for architecture and conventions.
