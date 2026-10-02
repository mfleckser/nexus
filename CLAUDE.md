# Nexus

  Personal life-system desktop app for Mark Fleckser. Unifies calendar, tasks,
  habits/goals, project planning, and AI coach UI. Built for personal use only.
  Non-technical planning/coaching lives in `~/Documents/Personal/LifeCoach/pursuits/nexus.md` —
  read that for motivations, roadmap, and feature spec context.

  ## Stack

  - Frontend: Electron + React + Vite + TypeScript
  - Backend: Python + Flask + Supabase client (PostgREST) — no ORM; schema lives in
    raw SQL migrations under `backend/supabase/migrations`, applied via the Supabase CLI
  - DB: Postgres on Supabase (separate project from Git Gains)
  - AI: Claude API (later phase)

  ## Core Principles

  - Everything interconnected. Tasks ↔ events ↔ habits ↔ projects ↔ goals via
    polymorphic `entity_links` (planned — table not built yet; direct FKs like
    `tasks.project_id` exist today).
  - Independent backend (not local-first). Mobile + multi-app integration are
    first-class motivations.
  - Built solo for personal use — no auth complexity, no multi-tenant, no premature
    abstractions. Customize features exactly how Mark wants.

  ## Roadmap

  1. MVP: Calendar + Tasks (goal: replace Google Calendar) — in progress
  2. Project Workshop — partly built (projects, features, kanban, notes) (pursuit-context + execution; rigid templates per type)
  3. Habits / Goals (with cross-feature triggers)
  4. AI coach UI (Claude API; deep integration w/ all features)
  5. Mobile companion
  6. Integrations (Git Gains API first)

  ## MVP Scope — Calendar + Tasks

  - Event CRUD: recurring, all-day, multi-day — done: CRUD + recurring; open: all-day
    and multi-day creation (`all_day` column exists, unused)
  - Day / week / month views — done: week; open: day (shows week), month (no events)
  - Task CRUD w/ due dates, optional time-block on calendar — done: CRUD, due dates,
    due-task pins on the week view; open: time-blocking
  - Tasks ↔ events linkable — open (`tasks.event_id` column exists, not in API)
  - Search across both — open
  - No GCal sync. No notifications (defer to mobile phase).

  ## Open Questions

  - Initial project-type templates beyond `coding`
  - Habit trigger model flexibility
  - Plugin/integration API shape
  - Auth model (bearer token vs Supabase Auth)

  ## Recurring Events

  - RFC 5545 RRULE body in `events.rrule` marks a series master; expanded server-side
    (`backend/app/services/recurrence.py`, python-dateutil) in the event's `timezone`.
  - Single-occurrence edits are override rows (`recurring_event_id` + `original_start_at`);
    cancelled occurrences go in master `exdates`.
  - Frontend never mutates recurring rows via plain `/events/<id>` — always
    `/events/<master>/occurrences/<original_start>` with scope `this|following|all`.

  ## Architecture

  - Request path: renderer → preload IPC (`window.api`) → main-process axios
    (`frontend/src/main/client.ts`) → Flask on `127.0.0.1:5000/api`. Renderer is
    sandboxed with no direct network or Node access.
  - Frontend data: one React context provider per entity (`useEvents`, `useTasks`,
    `useProjects`) with optimistic updates that roll back on failure, `useNow` polling
    plus refetch on window focus. Failures surface via `useReportError()` toasts.
  - Backend layout: `app/api` blueprints (thin) → `app/services` (logic, Supabase
    calls). Writes whitelist columns; input checks in `app/validation.py`.
  - Errors: every error is JSON `{"error": "<message>"}` (`app/errors.py`) — 400 bad
    input, 404 missing id, 500 otherwise. Success bodies are bare JSON.
  - Caching: Flask-Caching SimpleCache, keys + `get_or_load`/`invalidate` in
    `app/extensions/cache.py`. Standard for every entity: cached reads, and every write
    invalidates each key it can change, including FK on-delete side effects.
  - Config: `backend/.env` (`SUPABASE_URL`, `SUPABASE_KEY`; see `.env.example`).
    `NEXUS_DEBUG=1` enables debugger + reloader.
  - Tests: backend `unittest` against an in-memory fake (`tests/fake_supabase.py`);
    frontend `vitest` for pure helpers in `src/renderer/src/lib`. Setup and commands
    in `README.md`.

  ## Conventions

  Visual design / CSS conventions live in `frontend/CLAUDE.md`.

  Automated UI testing (Playwright `_electron`): launch with env `NEXUS_HIDDEN=1` so the
  window stays hidden and out of the Dock — no focus stealing. Rendering, clicks and
  screenshots still work.
