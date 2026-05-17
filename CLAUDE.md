# Nexus

  Personal life-system desktop app for Mark Fleckser. Unifies calendar, tasks,
  habits/goals, project planning, and AI coach UI. Built for personal use only.
  Non-technical planning/coaching lives in `~/Documents/Personal/LifeCoach/pursuits/nexus.md` —
  read that for motivations, roadmap, and feature spec context.

  ## Stack

  - Frontend: Electron + React + Vite + TypeScript
  - Backend: Python + Flask + SQLAlchemy
  - DB: Postgres on Supabase (separate project from Git Gains)
  - AI: Claude API (later phase)

  ## Core Principles

  - Everything interconnected. Tasks ↔ events ↔ habits ↔ projects ↔ goals via
    polymorphic `entity_links`.
  - Independent backend (not local-first). Mobile + multi-app integration are
    first-class motivations.
  - Built solo for personal use — no auth complexity, no multi-tenant, no premature
    abstractions. Customize features exactly how Mark wants.

  ## Roadmap

  1. MVP: Calendar + Tasks (goal: replace Google Calendar)
  2. Project Workshop (pursuit-context + execution; rigid templates per type)
  3. Habits / Goals (with cross-feature triggers)
  4. AI coach UI (Claude API; deep integration w/ all features)
  5. Mobile companion
  6. Integrations (Git Gains API first)

  ## MVP Scope — Calendar + Tasks

  - Event CRUD: recurring, all-day, multi-day
  - Day / week / month views
  - Task CRUD w/ due dates, optional time-block on calendar
  - Tasks ↔ events linkable
  - Search across both
  - No GCal sync. No notifications (defer to mobile phase).

  ## Open Questions

  - Initial project-type templates beyond `coding`
  - Habit trigger model flexibility
  - Plugin/integration API shape
  - Auth model (bearer token vs Supabase Auth)

  ## Conventions

  ### Visual Design

  Theme: **dark-only**, named "Midnight Study" — warm-neutral deep base with
  soft periwinkle accent. Inspired by VSCode / Claude Desktop / Discord. Evokes
  a calm late-night planning session; each life pillar feels like a room in the
  same house, not a separate app.

  **All color, spacing, typography, shadow, and radius decisions go through
  CSS custom properties defined in `frontend/src/renderer/src/theme.css`.**
  Never hardcode hex values, rgba, px shadows, or font stacks in component CSS
  — reference a token. If no token fits, add one to `theme.css` rather than
  inlining. `theme.css` is imported once in `App.tsx` before `root.css`.

  Token groups (see `theme.css` for full list):
  - Surfaces: `--bg-app`, `--bg-surface`, `--bg-elevated`, `--bg-hover`, `--bg-active`, `--bg-overlay`
  - Borders: `--border-subtle`, `--border-default`, `--border-strong`, `--border-focus`
  - Text: `--text-primary`, `--text-secondary`, `--text-muted`, `--text-disabled`, `--text-on-accent`
  - Accent: `--accent`, `--accent-hover`, `--accent-active`, `--accent-muted`, `--accent-border`
  - Life-pillar hues: `--pillar-calendar` (indigo), `--pillar-task` (mint),
    `--pillar-habit` (amber), `--pillar-goal` (orchid), `--pillar-project` (cyan),
    `--pillar-coach` (coral). Same desaturation family — use these for any
    feature-specific tinting (event chips, task pills, badges, icons).
  - Status: `--status-success`, `--status-warning`, `--status-danger`, `--status-info`
  - Shadows: `--shadow-sm`, `--shadow-md`, `--shadow-lg`
  - Radii: `--radius-sm` (4), `--radius-md` (8), `--radius-lg` (12), `--radius-pill`
  - Type: `--font-sans`, `--font-mono`

  **Layout patterns:**
  - "Floating panel on app bg": panels use `--bg-surface` with
    `--radius-lg` + `1px solid --border-default` + `--shadow-md`, placed inside
    a padded container with `--bg-app`. Calendar follows this pattern
    (`Calendar.tsx` → `#calendar-container` padding wrapper, `#week-container`
    rounded panel).
  - Subtle grid lines use `--border-subtle`; structural dividers use
    `--border-default`; emphasized edges use `--border-strong`.
  - Hover states swap to `--bg-hover`; active/selected to `--bg-active` or
    `--accent-muted`.
  - Opt into themed scrollbars by adding `.themed-scroll` to a scrollable
    element. Default scrollbars are hidden in calendar's vertical scroll.

  **Per-feature CSS lives next to the component** (e.g. `calendar.css`
  alongside `Calendar.tsx`). One CSS file per logical view. Avoid global
  utility sprawl; tokens + locally-scoped class names is enough at this size.

  No CSS-in-JS, no Tailwind. Plain CSS files + custom properties.

  **Scaffold leftovers**: `assets/base.css` and `assets/main.css` are
  electron-vite scaffold remnants and are **not imported**. Do not revive
  them; extend `theme.css` instead.
