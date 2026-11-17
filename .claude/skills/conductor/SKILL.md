---
name: conductor
description: "Work through the Nexus backlog (the app's \"Nexus\" project) unattended: triage todo/active tasks, block the ones that need Mark, run /implement on the rest in subagents, and open one PR (stacked when needed) per group for Mark to review. Invoked with /conductor [<feature name or goal>]."
argument-hint: "[<feature name or goal>]"
---

# Conductor

Work through Nexus backlog tasks without Mark: triage, group, order, implement
through `/implement`, and open PRs he can review. You orchestrate. Code, tests and
commits all happen inside `/implement` subagents.

Arguments: `$ARGUMENTS`. This is a feature name (e.g. "Projects Tab") or a goal in
plain words (e.g. "make the task list usable on mobile"). Leave it empty to work the
whole backlog.

## Principles

- **The backlog is the Nexus app's "Nexus" project.** Use the `mcp__nexus__*` tools.
  Never read or edit `BACKLOG.md` or `FABLE-WEEK.md`.
- **Mark is not in the loop.** Answer product questions yourself. Block a task only
  when it truly needs him (see Triage). Never wait on him, and never call
  `AskUserQuestion`.
- **Only Mark reviews and merges.** Never merge, approve, or close a PR, and never
  push to `main`.
- **Keep your context slim.** Keep only the task list, the branch/PR map, and each
  `/implement` summary block. Don't read code yourself. If a decision needs
  research, hand it to a subagent and take its conclusion. All state lives in Nexus
  and GitHub, so a later `/conductor` run with the same arguments picks up where
  this one stopped.
- **Models.** You are `opus`. Never use `fable`. Spawn `/implement` agents on `opus`
  at `high` effort; lookups go to `haiku` or `sonnet`.

## State markers

Task descriptions end with a `---` line followed by status lines. You may edit only
your own `Conductor:` line, in place. Never edit Mark's text, an answered `Blocked`
line, or Mark's answer to it. Leave those so the history stays with the task.

- In progress: `Conductor: branch <branch>`. Once the PR exists, add ` · PR <url>`.
  Once you've handled review comments, add ` · comments through <ISO time>`.
- Blocked: `Blocked (conductor, <YYYY-MM-DD>): <question or reason>. Options: … Recommended: …`
- Ordering that really matters: `Needs first: <task title>`. Add one only when doing
  the tasks out of order would break something. `add-task` writes this line in the
  same place.

Mark answers a blocked task by editing it and moving it back to `todo`. The answer
is then part of the task text.

## 1. Set up

1. **Worktree.** Do all git work in `<repo>/.claude/worktrees/conductor`, a
   persistent worktree that keeps you off Mark's checkout. If it doesn't exist:
   `git fetch origin`, `git worktree add --detach .claude/worktrees/conductor origin/main`.
   Then symlink `frontend/node_modules`, `backend/venv`, `tools/nexus-mcp/venv`,
   `frontend/.env` and `backend/.env` into it from the main checkout.
   **Keep it clean between tasks.** If the worktree has uncommitted changes from an
   interrupted or blocked `/implement` run, `/implement` would treat them as someone
   else's work. Before the next checkout or spawn, run
   `git stash push -u -m "conductor: <branch> <task title> <date>"` and mention the
   stash in that task's marker. This applies at startup and after every
   `/implement` run.

## 2. Triage

1. List `todo` and `active` tasks in the Nexus project
   (`b8e217f4-c03d-4f5c-8d3a-fddfecc29ad8`). Also list its features, so you can map
   names to ids.
2. **Choose the work set.**
   - A feature name: that feature's tasks.
   - A goal: the tasks that serve it.
   - No arguments: everything.

   Use both `todo` and `active` tasks, and add any prerequisites the set depends
   on. If a goal isn't covered by existing tasks, file the missing work (see Filing
   tasks) and add the new `todo` tasks to the work set.
3. **Check the active tasks' PRs first.** For each `active` task in the work set
   whose marker has a PR:
   `gh pr view <url> --json number,state,headRefName,baseRefName,mergeable,comments,reviews`.
   Inline review comments come from `gh api repos/mfleckser/nexus/pulls/<n>/comments`.
   - **`MERGED`**: set the task to `complete`.
   - **`CLOSED`** (not merged): set it to `cancelled`. If its PR applied migrations,
     note under **Cancelled** in the report that they're still live.
   - **`OPEN`**:
     - **New comments from Mark.** That means comments, review bodies and inline
       comments by `mfleckser` made after the marker's `comments through` time, or
       all of them if there's no such time. Your own replies post from the same
       account, so skip any comment that starts with `🤖 Conductor:`.
       - File a task for each distinct change he asks for (see Filing tasks).
         Combine comments that ask for the same change. Quote them word for word,
         with the file and line for inline comments, and include the PR and branch.
       - Give each new task a `Conductor:` line with the same branch and PR.
         `todo` ones join the work set; blocked ones wait for Mark. Comments that
         ask for no change get no task. If one asks a question, reply with a short
         answer now (see Replying to review comments).
       - Then update the original task's `comments through` to the time of the
         newest comment you handled.
     - **Restack if needed.** If its base PR was merged, rebase onto `origin/main`
       (`git rebase --onto origin/main origin/<old-base> <branch>`), push with
       `--force-with-lease`, and run `gh pr edit <n> --base main`. If it's
       `CONFLICTING`, rebase onto its base. Only rewrite branches you created, and
       only when every commit on them came from `/implement`. If anything else is on
       the branch, or the rebase conflicts, abort and block the branch's tasks with
       the reason.
     - The original task stays `active`, waiting on Mark.

   An `active` task with a branch but no PR was interrupted. It's workable again,
   on that branch.
4. **Sort each `todo` task.** Block it when it needs Mark:
   - work outside the repo: hardware, accounts, credentials, money, anything
     physical
   - a personal call with nothing to go on, like a name or a preference with no hint
     in the docs
   - too vague to act on, where `CLAUDE.md` and
     `~/Documents/Personal/LifeCoach/pursuits/nexus.md` don't make the intent clear
   - a product question whose wrong answer would destroy data or lock in the API
     contract for other clients

   Everything else is workable. Most product gaps aren't blockers: decide them and
   pass them in `decisions:`. Blocking a task means setting `blocked` and adding the
   marker with the question, the options, and your recommendation.
5. **Group and order the workable tasks.**
   - **A group** is tasks that belong in one PR: the same feature or the same code,
     small enough that one PR description explains it all. Each group gets one
     branch, a short kebab-case name for what it does.
   - **Order:** real dependencies first, then whatever moves the request forward
     most, then oldest first.
   - **Stacking:** a group that depends on another group's unmerged branch is
     stacked on it.
   - **Review fixes:** tasks filed from PR comments form a group on their PR's
     existing branch. These groups go first, so the PRs can be merged sooner.
   - **Waiting:** a task that depends on a blocked task stays `todo`.

## 3. Run each group

Groups run one at a time; they share the worktree. For each group:

1. **Branch.** Inside the worktree, do one of:
   - Resume an existing branch from a marker: `git checkout <branch> && git pull --ff-only`.
   - Create a branch from `origin/main`, or from the parent branch if stacked.

   For a new branch, run `git push -u origin <branch>` right away, so `/implement`
   finds it instead of creating it from `main`. If the checkout fails because
   another worktree uses the branch, block the group's tasks with the reason.
2. **Each task, in order.** Set it to `active` and write its branch marker. Then
   spawn a `general-purpose` agent (`opus`, `high`) with:

   ```
   Work only in <worktree absolute path>: cd there first. Every file and git
   operation happens there; never touch <main checkout path>, and don't remove the
   worktree. Invoke the `implement` skill with these arguments:

   <task title>
   <task description, verbatim, minus the Conductor: line>
   (Nexus feature: <feature name>)  ← only if it has one
   branch=<branch> unattended decisions: <your answers so far, or omit>

   When it finishes, reply with only its final summary block.
   ```

   Ignore everything but the summary block. For a `done` or `partial` result,
   confirm the reported commit is on `origin/<branch>` (`git fetch` and
   `git branch -r --contains <hash>`). If it isn't, treat the result as `blocked`.
   Handle each result:
   - **`done`**: keep it for the PR description.
   - **`needs-decision`**: answer each question yourself. Use its recommendation
     unless the request, `CLAUDE.md` or the pursuit doc point another way. Spawn
     again with the answers in `decisions:`. If a question falls under the blocking
     rules in Triage, block the task instead.
   - **`partial`**: spawn once more with the **Remaining** text as the task on the
     same branch. If it's still partial, file the rest (see Filing tasks) and treat
     this task as done.
   - **`blocked`**: set the task to `blocked` with the reason. Keep going with the
     rest of the group, unless they depend on it.

   After each task, check the summary's **Follow-ups**. File suggested new tasks and
   bugs found outside the task's scope (see Filing tasks). They go to the backlog,
   not this run's work set, unless the request needs them. Leave out review nits
   that don't deserve a task; those go in the PR's Follow-ups. If the task has a
   feature, append a short entry to its feature notes: branch, result, decisions
   made.
3. **Evidence.** Pick 2–3 items from the summary blocks' **Evidence**, at most, that
   best show what the PR does. Screenshots of visible changes come first.
   - Screenshots are stored on the `pr-evidence` branch, which is never merged. If
     it doesn't exist, create it once without a checkout:
     `git push origin "$(git commit-tree "$(git hash-object -t tree /dev/null)" -m 'PR evidence')":refs/heads/pr-evidence`.
   - Upload each PNG to `<branch>/<name>.png` there:
     `base64 -i <png> > <png>.b64`, then
     `gh api -X PUT repos/mfleckser/nexus/contents/<branch>/<name>.png -f message="Evidence for <branch>" -f branch=pr-evidence -F content=@<png>.b64`.
   - Embed it with
     `![<what it shows>](https://raw.githubusercontent.com/mfleckser/nexus/pr-evidence/<branch>/<name>.png)`.
   - Never commit screenshots to the PR branch.
4. **PR.** Once the group has at least one `done` task, write the description to a
   scratchpad file.
   - If the branch already has an open PR (review fixes), don't edit its
     description. Reply to the comments instead (see Replying to review comments).
   - Otherwise, open the PR:
   `gh pr create --base <main or parent branch> --head <branch> --title "<what the group does>" --body-file <file>`.
   - If it's stacked, link it: `gh stack link <parent PR> <this PR> --open`. If
     linking fails, keep the chained base and add a "Stacked on #N" line.
   - Add the PR URL to every done task's marker. The tasks stay `active`; Triage
     step 3 closes them once Mark merges.
   - Never use `gh pr merge` or `gh stack merge`.

### Filing tasks

Create every new task through the `add-task` skill, one invocation per task. Never
call `create_task` directly. Arguments: a description of the work, with whatever
context you have (where it came from: task title, branch, PR, and what the summary
block said), followed by `unattended`.

You answer its questions yourself, as its unattended mode describes. Put each
`add-task:` result line under **Filed** in the run report.

### Replying to review comments

Reply once each review-fix task finishes, and once for each comment that asks a
question. Start every reply with `🤖 Conductor:` so later runs can tell your replies
from Mark's comments. Keep it to 1–3 sentences:
- **Done:** what changed, the commit hash, and one embedded screenshot if the change
  is visible.
- **Blocked:** the question, the options, and your recommendation.
- **Question:** the answer. Hand any code research to a subagent.

Reply in the comment's own thread where GitHub allows it:
- Inline comments: `gh api repos/mfleckser/nexus/pulls/<n>/comments/<comment id>/replies -f body=<text>`.
- PR comments and review bodies have no threads. Use `gh pr comment <n> --body-file <file>`,
  starting with a link to the comment you're answering.

### PR description

Mark should understand every change in a couple of minutes without reading the
diff. Write it from the summary blocks:

```
<2–4 sentences: what this PR does for Mark, in product terms. "Stacked on #N." if stacked>

## Changes
### <task title>
- <what changed for the user, 1–3 bullets>
- Product calls: <defaults /implement took and answers you gave — or omit>
- Technical calls: <ones worth a second look — or omit>

## Evidence
<2–3 items max: embedded screenshots with a one-line caption, or a short output excerpt in a code block>

## Check it
<where to look in the app to see each change; tests/lint/UI checks run and results>

## Before merging
<migrations (flag any that change existing data), Pi deploy, env changes — or "Nothing">

## Follow-ups
<tasks filed, review findings left open — or omit>
```

End it with the PR attribution line from your current instructions.

## 4. Finish

Stop when nothing workable is left in the work set: every task is waiting in a PR,
blocked, or waiting on a blocked dependency. Check the worktree is clean, then
report:

```
## Conductor run — <arguments or "whole backlog">
PRs: <#N title (stacked on #M) — tasks: …> per line, or "none"
Completed (merged since last run): <tasks — or "none">
Cancelled (PR closed unmerged): <tasks; migrations left live — or "none">
Blocked: <task — reason> per line, or "none"
Waiting: <task — needs <blocked task>> per line, or "none"
Filed: <new tasks from review comments and follow-ups — or "none">
Manual steps: <Pi deploy, migrations to know about — or "none">
```

If the run stopped early (usage limit, an error you couldn't route around), say
where it stopped. The markers already let the next run resume.
