# Nexus

Personal life-system desktop app: calendar, tasks, projects (habits, goals and an AI
coach later). Electron + React frontend, Flask backend, Postgres on Supabase.

## Setup

Backend (Python 3.12, see `backend/.python-version`):

```sh
cd backend
python -m venv venv
venv/bin/pip install -r requirements-dev.txt
cp .env.example .env   # fill in SUPABASE_URL / SUPABASE_KEY
```

Frontend:

```sh
cd frontend
npm install
```

## Run

```sh
backend/start            # API on http://127.0.0.1:5000 (NEXUS_DEBUG=1 for reloader)
cd frontend && npm run dev
```

The frontend's main process calls the backend at `http://127.0.0.1:5000/api`
(`frontend/src/main/client.ts`). On macOS, port 5000 can clash with AirPlay Receiver
(System Settings → General → AirDrop & Handoff).

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
