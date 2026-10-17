# Nexus Backlog

Open items from the full project review (2026-10) and the mobile-readiness check.
Decisions marked **decide** need Mark's call before implementation. Feature work still
open in `FABLE-WEEK.md` (search, task↔event time-blocking, entity_links, etc.) is not
repeated here.

---

## 1. Mobile blockers — phone can't safely reach the backend yet

- [x] **Hosting** — Raspberry Pi: gunicorn (1 worker × 8 threads) on 127.0.0.1 behind
  `tailscale serve` HTTPS, systemd user unit; `NEXUS_TRUSTED_HOSTS` adds the ts.net
  name. Steps in README "Deploy".
- [x] **Auth** — static bearer token (`NEXUS_API_TOKEN`) on every route except
  `/api/health`.
- [x] **RLS + secret key** — RLS on every table with no policies
  (`20261016120000_enable_rls.sql`); backend uses the secret key, which bypasses RLS.
- [x] **Cache design** — kept; one gunicorn worker keeps it coherent, TTL 3600s → 60s
  bounds staleness from external writers (Studio).
- [x] **Backend URL config** — `MAIN_VITE_NEXUS_API_URL` / `MAIN_VITE_NEXUS_API_TOKEN`
  in `frontend/.env`; backend port via `NEXUS_PORT` (default still 5000).

## 2. API contract — lock before a second client depends on it

- [ ] **Response envelope** (decide) — `{data: ...}` vs bare JSON. Errors are already
  `{"error": msg}` with 400/404/500.
- [ ] **Written contract** — document endpoints (OpenAPI or short doc), version
  (`/api/v1`), shared/generated types (TS types live only in the desktop frontend).
- [ ] **Transactional recurring edits** — this/following/all scope edits are 2–3
  separate PostgREST writes; a mid-way failure can duplicate or lose occurrences. Move
  to Postgres RPC functions (or reorder writes so partial failure is harmless).
- [ ] **Concurrent-edit conflicts** (decide) — silent last-write-wins. Optional
  `updated_at` precondition → 409, or accept LWW knowingly.
- [ ] **Filtering / pagination** — `GET /tasks` returns everything; PostgREST
  `max_rows=1000` will silently truncate. Add `project_id`/`status`/`due_before` filters,
  exclude old completed tasks.

## 3. Data model & shared behaviour — settle once, in the backend

- [ ] **`created_via` column** — spec says "tag-now-or-never"; add before the first
  mobile write.
- [ ] **Schema constraints** — `tasks.status` nullable (CHECK passes NULL); no check on
  `projects.status`/`type`; no `events.end_at > start_at`; nullable timestamps.
- [ ] **All-day / multi-day creation** — MVP scope; `all_day` column unused, no backend
  all-day semantics, all-day row in week view always empty.
- [ ] **Task status semantics** (decide) — cancelled tasks land in kanban To Do; toggling
  an `active` task goes complete → todo (loses active); completed tasks with no due date
  or overdue vanish from the list with no undo while Today/Future keep them struck
  through.
- [ ] **Project delete semantics** (decide) — tasks are kept (`project_id` → null) and
  appear in the main list, but the confirm dialog only says the project is removed.
- [ ] **Feature rename** (decide) — Edit menu saves then reverts; no
  `PUT /features/<id>`. Add endpoint or hide the item. (`features.notes` has no endpoint
  either.)
- [ ] **Series shift wipes exceptions** (decide) — changing a series' time/duration/tz
  drops exdates and overrides, so a deleted occurrence reappears. Shift them by the
  delta, or keep + warn.
- [ ] **Split series linkage** (decide) — after a "this and following" split, an "all"
  edit on the earlier half only changes that half.
- [ ] **Move logic out of the desktop UI** — task due-date grouping (`TaskView`) and
  repeat-rule labels (`lib/rrule.ts`) would be duplicated by a mobile client; move to
  backend or a shared package.

## 4. Infrastructure

- [ ] **Test database** — UI tests and agents write "ZZ test" rows to the live DB. Create
  a separate Supabase project for tests/staging.
- [ ] **Playwright suite** (decide) — working hidden-mode suite exists only in a
  temporary scratchpad (t1–t6, ~3 min, hardcoded dates). Commit it to the repo now, or
  after the test DB exists.
- [ ] **CI** — backend unittest + ruff, frontend typecheck/lint/vitest on push.
- [ ] **Repo layout** (decide) — monorepo (`frontend/`, `mobile/`, shared `packages/`)
  vs separate repo. Expo/React Native makes shared TS types + API client cheap.
- [ ] **Logging / monitoring** — hosted backend needs readable logs; uptime check on
  `/api/health` (already checks the DB).

## 5. Mobile product decisions

- [ ] **Offline behaviour** (decide) — "not local-first" per CLAUDE.md; read-only cache,
  queued writes, or online-only.
- [ ] **Notifications** — deferred to mobile phase; needs reminder fields on
  tasks/events, a server-side scheduler, and push (Expo push or APNs).
- [ ] **Mobile MVP scope** (decide) — agenda + quick-add vs full calendar vs projects;
  whether the desktop day/month view gap carries over.

## 6. Desktop UI / UX

- [ ] **Day / month views** — "Day" shows the week; Month view shows no events.
- [ ] **Header month label** — shows one month for weeks spanning two ("Sep 2026" for
  Sep 27 – Oct 3).
- [ ] **Sidebar placeholders** (decide) — Fitness / Finances / AI links silently go
  to Home; hide or add "coming soon".
- [ ] **Empty-slot click** (decide) — clicking an empty cell to dismiss a popover also
  opens a New Event popover.
- [ ] **Initial scroll** (decide) — week grid opens at 12 AM; scroll to now / working
  hours?
- [ ] **Task pins** — draw over event titles; same-time pins stack downward (implying
  later times); pin time spills into next column at narrow widths.
- [ ] **Long text** — project titles/descriptions and long task titles aren't clamped.
- [ ] **Delete confirmation** — inline in task panel vs modal elsewhere; button layout
  differs.
- [ ] **Project list** — no sort order; empty project board has no hint text.

## 7. Design system

- [ ] **Placeholder styling** (decide) — error notices/toasts and the `:focus-visible`
  ring were added deliberately plain; restyle or keep. Select elements only get a border
  change on focus.
- [ ] **Button primitives** — five parallel button systems (`cd-btn`, `pm-btn`,
  `nep-btn`, `task-form-btn`, `kb-feature-btn`); consolidate into a shared set?
- [ ] **Spacing / type-scale tokens** — none exist; add a scale or keep as-is.
- [ ] **Category colours** — raw hex in `categories.json`; map to tokens or build the
  spec's `event_categories` table.

## 8. Code structure & tooling

- [ ] **Large components** — `NewEventPopover`, `EventChip`, `Calendar`; split?
- [ ] **Data-provider pattern** — three hand-rolled providers (poll / compare / mutate /
  rollback); small shared helper vs TanStack Query.
- [ ] **Component locations** — `ProjectModal` and `RecurrenceScopePrompt` live in
  `components/` but are feature-specific.
- [ ] **`noImplicitAny`** — off in the base tsconfig; turning it on would catch untyped
  handlers.
- [ ] **react-refresh rule** — silenced on the three provider files (provider + hook in
  one file), so HMR does a full reload there; split files if it gets annoying.
- [ ] **FABLE-WEEK.md** (decide) — Fable window is over; archive it and fold its open
  items into this backlog or Nexus's own "Nexus" project board.
