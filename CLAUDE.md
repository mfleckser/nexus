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

  - Event CRUD: recurring, all-day, multi-day — done
  - Day / week / month views — done
  - Task CRUD w/ due dates, optional time-block on calendar — done: CRUD, due dates,
    due-task pins on the week view, time-blocking ("Block time" on a task creates a
    linked event)
  - Tasks ↔ events linkable — done: `tasks.event_id` (one block per task; deleting
    the event clears it), linked tasks shown on event chips and the event popover
  - Search across both — open
  - No GCal sync. No notifications (defer to mobile phase).

  ## Open Questions

  - Initial project-type templates beyond `coding`
  - Habit trigger model flexibility
  - Plugin/integration API shape

  ## All-day Events

  - `all_day=true` rows span whole local days of their `timezone`: `start_at` = midnight
    of the first day, `end_at` = midnight after the last (exclusive). The backend 400s
    any write that leaves an all-day row off midnight (`_check_all_day`).
  - Frontend maps them to the viewer's days by their dates in the event's timezone
    (`lib/allDay.ts`: `daySpan`, `layoutDayBars`) and anchors edited dates back in that
    same zone (`zonedMidnight`); new events use the browser zone. Timed multi-day events
    stay in the time grid of day/week view; month view draws all-day and multi-day events
    as bars per week row (`lib/monthLayout.ts`, slots + "+N more" overflow).

  ## Recurring Events

  - RFC 5545 RRULE body in `events.rrule` marks a series master; expanded server-side
    (`backend/app/services/recurrence.py`, python-dateutil) in the event's `timezone`.
  - Single-occurrence edits are override rows (`recurring_event_id` + `original_start_at`);
    cancelled occurrences go in master `exdates`.
  - Frontend never mutates recurring rows via plain `/events/<id>` — always
    `/events/<master>/occurrences/<original_start>` with scope `this|following|all`.
  - Multi-row edits are atomic: the service computes every row change and sends them
    as ops to the `apply_event_writes` RPC (one transaction; mirrored in the fake).
    Its `relink_tasks` op moves time-blocked tasks to another event in the same edit.
  - Time-blocked tasks keep their link through edits: a "following" split moves tasks
    on the series to the half with its next occurrence from now (none left: the later
    half); tasks on an override stay on it as it is carried. An override the edit
    drops (kind switch, slot gone, rule cleared) hands its tasks to the series if it
    still occurs that day, else they're unlinked, as for a cancelled occurrence.
  - Moving a series (time, duration, timezone, rule) carries its exdates and overrides
    along by the same wall-clock shift; when a re-aimed monthly/yearly rule misses
    (2nd Tue → 2nd Wed), the same position in the same month/year. Ones the new
    series no longer has are dropped. A "following" split makes two independent
    series; "all" edits only touch one. All-day overrides move by whole days.
  - Switching a series' kind (all-day ↔ timed) drops its overrides; each exdate keeps
    its local day (moved like a series move, `_slot_map`: 9 AM → that day's midnight),
    dropped if the new series has no occurrence there. All-day checks run before the RPC.
  - Event writes are serialized by a per-process lock (`_write_lock`), one more
    reason to keep gunicorn at one worker. Against other writers (Studio), each RPC
    op on a row the edit was computed from carries the `updated_at` it read
    (`expect_updated_at`); a changed row fails the call (PT409), the service redoes
    the edit once from a fresh read, then returns 409.

  ## Architecture

  - Request path: renderer → preload IPC (`window.api`) → main-process axios
    (`frontend/src/main/client.ts`) → Flask at `MAIN_VITE_NEXUS_API_URL` + `/api`
    (`frontend/.env`, default `127.0.0.1:5001`). Renderer is sandboxed with no direct
    network or Node access.
  - Hosting: always-on backend on a Raspberry Pi — gunicorn (`backend/serve`, 1 worker
    × 8 threads, binds 127.0.0.1) behind `tailscale serve` HTTPS; systemd user unit in
    `backend/deploy/`. Steps in `README.md`. `backend/start` stays the dev server.
  - Auth: static bearer token. Every route except `/api/health` needs
    `Authorization: Bearer <NEXUS_API_TOKEN>` (`app/auth.py`); desktop sends
    `MAIN_VITE_NEXUS_API_TOKEN`. Supabase RLS is on with no policies; backend uses the
    secret key, clients only ever talk to the Flask API.
  - Frontend data: one React context provider per entity (`useEvents`, `useTasks`,
    `useProjects`) with optimistic updates that roll back on failure, `useNow` polling
    plus refetch on window focus. Failures surface via `useReportError()` toasts.
  - Backend layout: `app/api` blueprints (thin) → `app/services` (logic, Supabase
    calls). Writes whitelist columns; input checks in `app/validation.py`.
  - Errors: every error is JSON `{"error": "<message>"}` (`app/errors.py`) — 400 bad
    input, 404 missing id, 409 row changed under a recurring edit (`Conflict`), 500
    otherwise. Success bodies are bare JSON.
  - Caching: Flask-Caching SimpleCache, keys + `get_or_load`/`invalidate` in
    `app/extensions/cache.py`. Standard for every entity: cached reads, and every write
    invalidates each key it can change, including FK on-delete side effects. Cache is
    per-process: keep gunicorn at one worker; 60s TTL bounds staleness from external
    writers (Studio).
  - Config: `backend/.env` (`SUPABASE_URL`, `SUPABASE_KEY`, `NEXUS_API_TOKEN`,
    optional `NEXUS_TRUSTED_HOSTS`, `NEXUS_PORT`; see `.env.example`). `NEXUS_DEBUG=1`
    enables debugger + reloader.
  - Agent tools: stdio MCP server `tools/nexus-mcp/server.py` (registered in `.mcp.json`)
    exposes projects / features / tasks to Claude Code as a normal API client (same
    backend + token as `frontend/.env`). No delete tools; feature notes are the agents'
    decision/result log (`append_feature_notes`). `append_feature_notes` and `update_task`
    return short acks (read back with `get_feature` / `get_task`) to save agent tokens.
    New endpoints agents need get a tool there.
  - Agent workflow (`.claude/skills/`): the backlog is the app's "Nexus" project.
    `/add-task` writes a task spec (settles product questions with Mark), `/conductor`
    triages tasks and runs `/implement` per task unattended, then opens one PR per
    group (stacked via `gh stack`). Independent PRs run in parallel lanes (max 3,
    worktrees `.claude/worktrees/conductor-<n>`, backend ports 5055–5057). Only Mark
    merges.
  - Tests: backend `unittest` against an in-memory fake (`tests/fake_supabase.py`);
    frontend `vitest` for pure helpers in `src/renderer/src/lib`; MCP tools `unittest`
    against a fake API plus a live `smoke.py`. Setup and commands in `README.md`.

  ## Conventions

  Visual design / CSS conventions live in `frontend/CLAUDE.md`.

  Automated UI testing (Playwright `_electron`): launch with env `NEXUS_HIDDEN=1` so the
  window stays hidden and out of the Dock — no focus stealing. Rendering, clicks and
  screenshots still work.
