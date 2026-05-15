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

  _Fill in as patterns emerge._
