---
name: stylize
description: Restyle a UI component to match Nexus's "Midnight Study" design system without changing behavior. Use when the user asks to style, restyle, polish, or improve the look of a component/page/view. Invoked with /stylize <component>.
---

# Stylize

Make the UI component the user names **look better** and consistent with the rest of Nexus. Visual only — assume the component already works; do not verify or fix functionality.

## Scope — visual only

Allowed:
- Edit/add the component's CSS file and `theme.css`.
- Change `className`s in the JSX.
- Restructure markup purely for layout (wrapper/container divs, reordering elements, splitting an element for styling).

Forbidden — never touch:
- Event handlers, state, hooks, props, context, data fetching.
- Conditionals, loops, or anything that changes what renders or when.
- Component logic, imports of logic, types.

If a visual goal seems to require a functional change, stop and ask the user instead of doing it.

## Procedure

1. **Read the design system first** (do not skip — styling without this will not match):
   - `frontend/src/renderer/src/theme.css` — the full token list (surfaces, borders, text, accent, pillar hues, status, shadows, radii, type).
   - The `## Conventions` → Visual Design section of `CLAUDE.md` — token groups, layout patterns, the per-feature-CSS rule.
   - For deeper design intent/motivation, `~/Documents/Personal/LifeCoach/pursuits/nexus.md`.
2. **Read a sibling component for reference.** Open `Calendar.tsx` + `calendar.css` (the canonical "floating panel on app bg" pattern) and, if styling within a feature, its existing siblings. Match their structure, spacing rhythm, and class-naming style.
3. **Identify the component's pillar hue** if feature-specific (calendar/task/habit/goal/project/coach) and tint with that token.
4. **Style it.** Apply the rules below.
5. **Report** which files you changed and the key visual decisions.

## Hard rules

- **Tokens only.** No hardcoded hex, rgba, px shadows, or font stacks in component CSS — always reference a `--token`. If no token fits, **add one to `theme.css`** (in the right group, with a comment) rather than inlining a raw value.
- **CSS location.** Per-feature CSS lives next to the component, one file per logical view (e.g. `kanbanBoard.css` beside `KanbanBoard.tsx`). Don't add to global/scaffold CSS. `assets/base.css` and `assets/main.css` are dead scaffold — never touch or import them.
- **Layout patterns** (from CLAUDE.md):
  - Floating panel: `--bg-surface` + `--radius-lg` + `1px solid --border-default` + `--shadow-md`, inside a padded `--bg-app` container.
  - Grid lines `--border-subtle`; structural dividers `--border-default`; emphasized edges `--border-strong`.
  - Hover → `--bg-hover`; active/selected → `--bg-active` or `--accent-muted`.
  - Themed scrollbars: add `.themed-scroll` to scrollable elements.
- **No CSS-in-JS, no Tailwind.** Plain CSS files + custom properties only.

## Aesthetic bar

Aim for the calm, late-night, VSCode/Claude-Desktop/Discord feel: generous but consistent spacing, clear hierarchy via text tokens (`--text-primary/secondary/muted`), soft elevation via the shadow tokens, restrained accent use. Better to be clean and consistent with the app than novel.
