# Fable Week — Nexus Task Queue

Scratch backlog for the Fable availability window (~Jul 1–8, 2026). Coding agent reads this
**top-down** and works the highest item still unchecked. Check off `[x]` when done.

**Rules for the agent**
- Work in priority order (Tier 1 → 4). Don't skip ahead unless blocked.
- Tags: **ROI** H/M/L · **fit** stamp (mechanical, go fast) / deep (needs a design decision — flag, don't guess) · **size** S/M/L.
- Items marked ⚠️ **deep**: stop and surface a recommendation before implementing. Don't burn the Fable clock guessing.
- After each task: check the box, note the PR/branch inline.
- Do NOT touch the "Defer" section — out of scope this week.

---

## Tier 1 — do first (high ROI, stampable, unblocks everything)

### Finish F1 — Project Workshop (dogfooding: get Nexus tracking itself)
- [ ] Project edit — wire Edit menu (title/desc/type/status) + `PUT /projects/:id` endpoint + service · H·stamp·M
- [ ] Project notes — edit UI + PUT support (notes field already in schema) · H·stamp·S
- [ ] Task ↔ project on Home — show which project each task belongs to; allow assigning an unscoped task to current project from TaskView · H·stamp·M
- [ ] Cache consistency — **DECIDED:** add caching for projects, and make it the standard pattern applied to every new entity type going forward. Bring projects in line with the tasks/events caching approach. · M·stamp·S

### F3 — Backend hygiene (cheap, unblocks all downstream work)
- [ ] Fix `requirements.txt` — add `supabase`, `flask-caching`; remove unused Flask-SQLAlchemy / psycopg2; update CLAUDE.md to say "Supabase client" not SQLAlchemy · H·stamp·S
- [ ] Consistent API responses — `{ "data": ... }` on success, `{ "error": { "code", "message" } }` on failure; proper status codes (404 missing id, 400 bad input) · H·stamp·M
- [ ] Input validation — required fields, enum checks (status in `todo|active|complete|cancelled`); stop passing raw `request.json` straight to Supabase · H·stamp·M
- [ ] Filtered list endpoints — `GET /tasks?project_id=&status=&due_before=`, `GET /events?start=&end=` (date range) · H·stamp·M
- [ ] Health check — return `{ "status": "ok", "db": "connected" }` instead of "Hello World" · M·stamp·S

---

## Tier 2 — daily-use payoff (replace Google Calendar)
- [ ] Task ↔ event time-blocking — add `event_id` to task update API fields; UI to block a task on the calendar (create event + link); show linked tasks on event chips · H·stamp·M
- [ ] Event editing — edit/delete existing events (create flow exists; verify edit path) · H·stamp·S
- [ ] Search — `GET /search?q=` across tasks + events (title/description) + search bar in sidebar or Home header · M·stamp·M
- [ ] ⚠️ Recurring / all-day / multi-day events — UI + service logic (schema supports some). Bigger job — defer unless time remains · M·**deep**·L
- [ ] Day / month calendar views — add or stub (week view exists) · L·stamp·M

---

## Tier 3 — quality + unblocks agent writes showing in the UI
- [ ] Refresh on write — after any mutation, refetch that resource; keep `useNow` poll as fallback only · H·stamp·M
- [ ] Route-scoped providers — move `ProjectsProvider` inside `/projects` route (don't load projects on Home); same pattern for future pillars · M·stamp·S
- [ ] Error rollback — on failed `updateTask`/`updateEvent`, revert optimistic state + show toast · M·stamp·S
- [ ] Shared fetch helper — extract repeated context pattern (fetch, sameSet, mutate, refresh) into one hook · M·stamp·M

---

## Tier 4 — if quota survives (foundational, less daily-visible)

### F4 — Cross-feature linking (entity_links)
- [ ] Migration: `entity_links` table — `(source_type, source_id, target_type, target_id, link_type, created_at)`; types: task, event, project, feature · M·stamp·S
- [ ] Link service — `create_link`, `delete_link`, `get_links_for(entity)` · M·stamp·M
- [ ] UI: show links — task detail "Linked to: …"; project detail related tasks/events · M·stamp·M
- Keep direct FKs (`tasks.project_id` etc.); use entity_links for cross-pillar relationships only.

---

## Design — frontend visual revamp (parallel track, time-boxed)
Lift Nexus UI from "fine" to "great." Currently functional but unremarkable.

**Tooling — decide first (off-Fable, quick):** a specialized design skill/plugin that fits the stack, vs. Claude's built-in design capability. Pick one before starting.

- [ ] Audit current UI — screenshot key screens (Home, Projects/Kanban, Calendar); note weak points (spacing, hierarchy, color, typography, consistency) · M·deep·S
- [ ] Design system — color palette, type scale, spacing, component primitives (buttons, cards, inputs, chips). One source of truth. · H·deep·M
- [ ] Restyle screen-by-screen against the system · M·explore·L

**How to use Fable here:** design = taste, not pure stamp. Use Fable for its strength — **generating layout/component variants fast** to explore the space cheaply. Final taste calls stay with you / Opus.

⚠️ **Quota guard:** don't let a design rabbit hole eat the quota meant for Tiers 1–3 shipping. Time-box it. Best run after Tier 1 lands, or as an off-Fable exploration in parallel.

**Post-week (defer — workflow meta-work, don't build now):** wire a design step into the feature pipeline — every new frontend feature gets a design/mockup+approve pass BEFORE implementation. Formalize once the design system above exists.

---

## Defer past Fable week — do NOT work these (low Fable-fit: need architecture decisions / novel design; depend on Tiers 1–3 being solid). Save for Opus deep sessions.
- F6 — Agent action audit log
- F7 — MCP toolkit
- F8 — AI Coach tab
- F9 — Agent debates & arbitration
- F10 — New life pillars (fitness, finance, mobile, Git Gains integration)

---

**Quota floor:** if Fable runs out mid-week, Tier 1 alone leaves Nexus dogfoodable with a clean backend — a safe stopping point.
