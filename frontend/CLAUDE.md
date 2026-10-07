# Nexus Frontend

  ## Visual Design

  Theme: **dark-only**, named "Midnight Study" — warm-neutral deep base with
  soft periwinkle accent. Inspired by VSCode / Claude Desktop / Discord. Evokes
  a calm late-night planning session; each life pillar feels like a room in the
  same house, not a separate app.

  **All color, shadow, radius, and font-family decisions go through CSS custom
  properties defined in `frontend/src/renderer/src/theme.css`.** (No spacing or
  type-size scale tokens exist yet.)
  Never hardcode hex values, rgba, px shadows, or font stacks in component CSS
  — reference a token. If no token fits, add one to `theme.css` rather than
  inlining. `theme.css` is imported once in `App.tsx` before `root.css`.

  Use the `--pillar-*` hues for any feature-specific tinting (event chips, task
  pills, badges, icons).

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
  alongside `Calendar.tsx`). One CSS file per logical view. File names: components
  PascalCase (`TaskForm.tsx`), CSS and non-component modules camelCase
  (`taskForm.css`, `useNow.ts`), directories camelCase. Avoid global
  utility sprawl; tokens + locally-scoped class names is enough at this size.

  No CSS-in-JS, no Tailwind. Plain CSS files + custom properties.
