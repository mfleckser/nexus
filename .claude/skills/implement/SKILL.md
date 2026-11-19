---
name: implement
description: "Take one Nexus feature, fix, or chore and implement it end to end without needing Mark: plans, builds, tests, reviews, commits and pushes to a branch, with effort scaled to the task's size, then returns a summary. Invoked with /implement <task> [branch=<name>] [base=<branch>] [port=<n>] [unattended] [decisions: ...]."
argument-hint: "<task description> [branch=<name>] [base=<branch>] [port=<n>] [unattended] [decisions: ...]"
---

# Implement

Take **one** task to committed, pushed, verified code, then return a summary. You are
the conductor: you own the result, decide how much process it needs, and may hand
pieces to subagents.

Arguments: `$ARGUMENTS`
- **Task**: the spec. Treat the text you were given as the whole task. It may come
  from any source; don't go looking for it in a backlog file, and don't edit planning
  files. Whoever invoked you tracks the task.
- **`branch=<name>`** (optional): the branch to commit to. If omitted, see step 6.
- **`base=<branch>`** (optional): the branch this one is stacked on. Reviews diff
  against it (step 5). Default `main`.
- **`port=<n>`** (optional): the local backend port for UI checks. Default `5055`.
  Other agents may run in parallel on other ports, so use only this one.
- **`decisions:`** (optional, always last): product answers already made. They are
  settled.
- **`unattended`** (optional): nobody is watching. Never wait on Mark. Also treat
  the run as unattended if `AskUserQuestion` isn't available to you.

## Principles

- **Mark is not in the loop.** Product questions were meant to be answered before
  the task reached you. Decide technical details yourself. Product gaps are handled
  once, up front, in step 2.
- **Match effort to the task.** A one-line fix gets no plan, subagents, or formal
  review. A cross-stack feature gets all of them. Don't pad small tasks or rush big
  ones.
- **Follow the docs.** `CLAUDE.md` (architecture, caching, errors, recurring-events
  rules), `frontend/CLAUDE.md` (visual design, tokens, file naming). New code should
  look like the code next to it.
- **Models.** You (the main agent) are `opus`, the strongest model available. Never
  use `fable`. For subagents, pick the model and `effort` per unit (step 4).
- **Scratch per branch.** Parallel lanes share one scratchpad. Create
  `<scratchpad>/<branch>/` when you start (`<branch>` as given, or `main`) and keep
  every scratch file and all evidence in it, never under generic names at the
  scratchpad root. Subagents you spawn get paths under the same folder.

## 1. Understand and size the task

1. Read `CLAUDE.md`, plus `frontend/CLAUDE.md` if the task touches UI. Read the
   relevant part of `~/Documents/Personal/LifeCoach/pursuits/nexus.md` when the
   product intent is unclear.
2. Read the code the task touches. For a broad sweep across many files, use an
   `Explore` subagent (`haiku` or `sonnet`) and only take its conclusions.
3. Pick a tier. It drives every later step:

| Tier | Looks like | Planning | Agents | Review |
|---|---|---|---|---|
| **S** | One layer, ≤ ~3 files, obvious approach (clamp text, add a CHECK constraint, fix a label) | None | Just you | Re-read your own diff |
| **M** | One feature across a layer or two, an approach is needed but it's clear (filter params on `GET /tasks`, the header month label) | A short plan in your head or the branch folder | Usually just you; maybe one helper for an independent piece | `code-review` at `medium`, one fix round |
| **L** | Cross-stack, schema + API + UI, or a risky change to shared behavior (all-day events, transactional recurring edits, time-blocking) | Written plan in the branch folder: API/data contract, files, steps, test plan | You conduct; subagents build separable units | `code-review` at `high` per unit plus a final full pass, with a fix loop |

If the task is too big for one pass, build the first slice that works on its own,
and report the rest under **Remaining** with status `partial`. If a wrap-up message
arrives mid-run, stop at a clean point, commit and push working code, leave the
worktree clean, and return `partial` with a precise **Remaining** list.

## 2. Resolve open product questions (once, before any code)

List every product decision the spec and `decisions:` leave open: behavior, UX, what
the user sees in edge cases, what happens to existing data. Technical choices don't
count. Make those yourself, even large ones, and note them in the report.

- **Interactive** (Mark invoked you directly and `unattended` isn't set): ask all
  open questions in **one** `AskUserQuestion` call. Put the recommended option first,
  tagged "(Recommended)", and make each question make sense on its own.
- **Unattended**: sort each open question.
  - **Default it** when it's easy to change later, or when the codebase, docs or
    spec point clearly one way. Take the option a careful product owner would most
    likely pick, and list it under **Product defaults** in the report.
  - **Escalate it** when a wrong guess would be expensive to undo: it would make
    the task's main behavior ambiguous, destroy existing data, or fix a shape that
    other clients will depend on. Escalated questions are the only ones that stop
    you. Stop before writing code and return status `needs-decision` with each
    question, its options, and your recommendation, so the caller can answer and run
    you again with `decisions:`.

Most tasks have nothing to escalate. Don't escalate to dodge a judgment call.

After this step, keep going. If a new product question comes up mid-build, take the
reasonable default and record it.

## 3. Plan (tier M/L)

- **M**: name the files you'll change, the API shape if there is one, and how you'll
  verify it. Keep it short.
- **L**: write `<scratchpad>/<branch>/plan.md` with:
  - the contract (endpoints, request/response JSON, DB columns, TS types)
  - work units with file ownership, so no two agents edit the same file
  - order and dependencies (usually migration → backend service/API + tests →
    frontend provider/types → UI)
  - the test plan
  - risks

  For a design that is truly hard (recurrence math, transactional writes, a new data
  model), have a `Plan` subagent on `opus` at `xhigh` effort stress-test the plan.
  Then decide yourself.

## 4. Build, with an iteration loop

**Delegation (L, sometimes M).** Give each subagent a self-contained brief: the
contract, the files it owns, the conventions that apply (point it at the CLAUDE.md
sections), what "done" means (including which tests must pass), its scratch path
under `<scratchpad>/<branch>/`, and "don't commit".
Run units in parallel only when their files don't overlap. Set `model` and `effort`
on every spawn:

| Work | model / effort |
|---|---|
| Lookups, reading many files, mechanical edits | `haiku` / `low` |
| Well-specified unit with a clear contract (endpoint + tests, a component to a spec) | `sonnet` / `medium` |
| Unit that needs judgment, or touches shared/tricky code | `opus` / `high` |
| The hardest design or debugging (recurrence, concurrency, a failure that keeps coming back) | `opus` / `xhigh` |

Read every unit's diff yourself before moving on. You are responsible for the seams
between units.

**Loop for each unit (or for the whole task at S):** implement → verify → fix →
repeat until green.
- If the same failure survives 3 honest attempts, stop patching. Re-read the code and
  try a different approach, or hand it to an `opus`/`xhigh` subagent with everything
  you've learned.
- If it still won't go after that, stop and return status `blocked` with exactly
  what's blocking. Don't ship around it.

**Verification by layer** (commands in `README.md` → "Test and lint"):
- **Backend**: `cd backend && venv/bin/python -m unittest discover -s tests`, then
  `venv/bin/ruff check . && venv/bin/ruff format --check .`. New or changed
  service/API behavior gets unittest coverage against `tests/fake_supabase.py`. If
  the fake doesn't support a query you need, extend it.
- **Migrations**: create with `supabase migration new <name>` from `backend/`, then
  apply with `supabase db push`. You don't need to ask first. Write migrations so
  existing rows pass any new constraint (backfill in the same migration if needed).
  If a migration drops or rewrites existing data, make sure the task really requires
  it, and call it out in the report.
  **Unattended, until a separate test database exists:** `db push` changes the live
  database before Mark has reviewed anything, and a closed PR doesn't undo it. So
  only apply migrations that add things the code on `main` tolerates: new tables,
  nullable or defaulted columns, indexes, and constraints every existing row passes.
  If the task needs anything else (drop, rename, type change, rewriting data),
  escalate it in step 2 as `needs-decision` before writing code.
- **Frontend**: from the repo root, `npm run typecheck && npm run lint && npm test`
  (desktop app and `packages/shared`). Pure helpers in `src/renderer/src/lib` or
  `packages/shared/src` get vitest tests.
- **UI behavior (M/L tasks with visible changes)**: drive the real app with
  Playwright `_electron`. Always set `NEXUS_HIDDEN=1` so the window never steals focus.
  - Playwright isn't a project dependency. Install `playwright-core` in
    `<scratchpad>/<branch>/pw` (`npm init -y && npm i playwright-core`) and launch
    with `executablePath` set to the default export of
    `node_modules/electron/index.js` (repo root) and `args: [<frontend dir>]`.
  - If backend code changed, run it locally on your port (`port=`, default 5055):
    `NEXUS_PORT=<port> backend/start`, in the background. Restart it after more
    backend edits (no reloader). Stop it by the PID on that port only
    (`lsof -ti tcp:<port> -sTCP:LISTEN`); never `pkill` by name, which can hit Mark's
    own dev server or another agent's. If the port is already taken when you start,
    report `blocked` rather than using someone else's server.
  - Build against that backend:
    `MAIN_VITE_NEXUS_API_URL=http://127.0.0.1:<port> npx electron-vite build`.
    Otherwise a plain build talks to whatever `frontend/.env` points at. When done,
    rebuild with a plain `npx electron-vite build` so `out/` doesn't keep the test
    URL baked in.
  - Test data goes in the live DB: name it `ZZ test …` and delete it afterwards, in a
    `finally`, one delete at a time so one failure doesn't leak the rest.
  - Keep scripts and screenshots in `<scratchpad>/<branch>/`. Look at the
    screenshots.
- **Evidence (any tier)**: keep 1–2 pieces that show the change works, and list them
  under **Evidence** in the summary. For a visible change, that's a screenshot
  cropped to the relevant part of the window, saved as
  `<scratchpad>/<branch>/<name>.png` and listed by its absolute path. Take one even
  at tier S. For a non-visual change, use a short excerpt of test output or an API
  response.
- **Agent tools (`tools/nexus-mcp`)**: `venv/bin/python -m unittest discover -s tests`
  and `../../backend/venv/bin/ruff check .`. If you add an endpoint agents need, add
  the tool and test it; run `smoke.py` against a local backend
  (`NEXUS_API_URL=http://127.0.0.1:<port>`) when the backend changed.

## 5. Review (scaled to tier)

Every review covers this branch's changes against its base, nothing else:
- First confirm `git rev-parse --show-toplevel` and `git branch --show-current` are
  the worktree and branch you're building, and run the review from there.
- The diff is `git diff <mb>`, where `<mb>` is `git merge-base origin/<base> HEAD`:
  commits plus uncommitted work. Its files are `git diff --name-only <mb>` plus
  untracked files in `git status --short`.

- **S**: read that diff start to finish for leftovers, debug output, and convention
  breaks.
- **M**: invoke the `code-review` skill at `medium` with an explicit target: the
  branch against its base (`origin/<base>...HEAD`, plus uncommitted changes), never
  the implicit "current diff". Fix the findings that hold up after you check them,
  rerun verification, done.
- `code-review` runs in the background. Wait for its result before committing, and
  give every finding a verdict (fixed, or why not) in your summary. When it arrives,
  before acting on any finding, check that the files it reviewed match the diff's
  files. If not, discard it and re-run with the explicit target. If it still doesn't
  match, review the diff by hand and say so under **Verified**.
- **L**: `code-review` at `high` after each major unit lands (target that unit's
  commits or files within the same base), then once more over the full diff. If the
  change added a lot of code, run `simplify` too. Loop
  fix → verify → re-review until a pass turns up nothing significant (at most 3
  rounds; anything left over goes under **Follow-ups**).
- Never use the `max` or `ultra` review levels.

Then fix anything in `CLAUDE.md` / `frontend/CLAUDE.md` that is no longer true (e.g.
MVP Scope "open: …" lines, architecture bullets). Add something only for a genuinely
new concept that future work needs. Keep it small. This is the only planning-style
doc you edit.

## 6. Commit and push

**Choose the branch:**
- `branch=` given: use it. If it exists locally or on `origin`, check it out and
  `git pull --ff-only`. If it doesn't exist, create it from an up-to-date `base`
  (default `main`).
- No branch given: commit to `main`.

**Protect work that isn't yours.** Check `git status` before you start building, not
just at commit time.
- If there are uncommitted changes you didn't make, never stash, reset, discard, or
  commit them.
- If you'd have to switch branches under them, build in a worktree at
  `.claude/worktrees/<branch>` (gitignored). Symlink `backend/venv`,
  `tools/nexus-mcp/venv`, `frontend/.env` and `backend/.env` into it from the main
  checkout, and run `npm ci` at its root. Don't symlink `node_modules`: its
  `@nexus/shared` link would point at the main checkout's `packages/shared`.
  Remove the worktree after pushing.
- If you can stay on the current branch, stage only your own files.

**Commit:**
- Stage specific paths only. Never `git add -A`, never a `.env`.
- Use one commit for S/M. Use a few logical commits for L when it reads better (e.g.
  schema+backend, then frontend).
- Message: imperative, under 72 characters, describes the change. Add `; update
  CLAUDE.md` if you updated it. End with the attribution line from your current
  instructions.

**Push** with `git push -u origin <branch>`. Never force-push. If the push is
rejected, `git pull --rebase` and push again. If the rebase conflicts in code you
didn't write, stop and return `blocked`; don't guess at resolutions.

## 7. Return the summary

**PR section.** For `done` or `partial`, first write your task's part of the PR
description to `<scratchpad>/<branch>/pr-section-<task-slug>.md` (`<task-slug>`: the
task title in kebab-case; several tasks can share a branch). If it already exists
(a resumed partial task), update it to cover the whole task. The conductor pastes
it into the PR as is (see "PR description" in `.claude/skills/conductor/SKILL.md`),
so write it for Mark, from the same facts as the summary block:

```
### <task title>
- <what changed for the user, 1–3 bullets>
- Product calls: <the Product defaults, plus answers given in decisions: — or omit the line>
- Technical calls: <ones worth a second look — or omit the line>

#### Evidence
- `<name>.png`: <one-line caption>  ← per screenshot, by its filename
- <one-line caption>, then the excerpt in a code block  ← per output excerpt
```

End with exactly this block, short and factual. It is the whole hand-off to your
caller, so write it to stand on its own:

```
## Result: <done | partial | blocked | needs-decision> — <task title>
Branch / commits: <branch> @ <hash> — <message> (pushed | not pushed: why) — or "none"
Changed: <2–5 bullets, what changed for the user, not a file list>
Product defaults: <product questions you answered yourself, with the choice made — or "none">
Technical decisions: <notable calls a reviewer might want to revisit — or "none">
Verified: <tests/lint/typecheck/UI checks run and their results; anything skipped and why>
Evidence: <1–2 items: absolute PNG path + what it shows, or a short output excerpt — or "none">
PR section: <absolute path of the pr-section file — or "none">
Migrations: <applied migrations, noting any that changed existing data — or "none">
Manual steps: <Pi deploy (`git pull && systemctl --user restart nexus-backend`) if backend changed, env changes — or "none">
Remaining: <for partial: what's left to finish the task — or "none">
Follow-ups: <leftover review findings, bugs noticed outside scope, suggested new tasks; prefix feedback on the implement/conductor/add-task skills (not the app) with `workflow:` — or "none">
Questions: <for needs-decision: each question, options, recommendation — or "none">
```

If tests were skipped or failed, say so plainly in **Verified**. Don't report `done`
with red checks.
