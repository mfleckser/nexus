---
name: add-task
description: "Turn a description of work (feature, fix, bug) into one well-specified task in the Nexus backlog (the app's \"Nexus\" project): settles product and taste questions up front, files it in the right feature, and writes a description /implement can build from. For Mark or an agent like the conductor. Invoked with /add-task <description> [unattended]."
argument-hint: "<what the task should accomplish> [unattended]"
---

# Add task

Turn one piece of work into one task in the Nexus project of the Nexus app
(`b8e217f4-c03d-4f5c-8d3a-fddfecc29ad8`), using the `mcp__nexus__*` tools. Write it
so `/implement` can build it without asking anything. This skill is only for that
project; other projects (School, etc.) get tasks through the MCP tool directly.

Arguments: `$ARGUMENTS`
- **Description**: what the task should accomplish, a bug and how it shows up, or a
  follow-up from another agent.
- **`source: verified | unverified`** (optional): whether the caller's facts were
  already confirmed in code (`verified`, e.g. by an `/implement` summary block).
  Without it, treat the source as unverified.
- **`unattended`** (optional): an agent is calling, not Mark. Also treat the run as
  unattended if `AskUserQuestion` isn't available to you.

## 1. Gather context

1. List the project's `todo`, `active` and `blocked` tasks, and its features.
2. **Duplicates.** If an existing task already covers this work, don't create a new
   one.
   - With Mark: offer to update that task instead.
   - Unattended: if the request adds something new, append it to that task's
     description, above any `---` line. Otherwise skip it. Then report.
3. **Code.** Unless the code already answers the question, take a quick look at what
   the work touches. Use an `Explore` subagent on `haiku` or `sonnet` at `low`, and
   keep only its conclusions. You're looking for three things:
   - what already exists, so you don't ask about it or spec it
   - what the change touches
   - whether it has to wait for another open task

   Skip the lookup if the request is purely a product idea, or its source is
   `verified`: take those facts as given, and judge from the task list alone
   whether it has to wait for another task. An unverified source (e.g. a code
   review finding, which can misfire) always gets the lookup. Check the problem it
   describes is real; if it isn't, skip the task.
4. **Size.** If it's really several independent tasks, say so and suggest a split.
   With Mark, create one task anyway if he wants. Unattended, create one task for
   what the caller asked; the caller can call again for the rest.

## 2. Settle the open questions

List what the request leaves open.
- **Product and taste matter most**: what the user sees, wording, layout, behavior
  in edge cases, what happens to existing data. Get as many of these answered as you
  can.
- **Technical questions** count only when there's no clear right answer. If one
  option is obviously right, don't ask and don't write it down; `/implement` will
  make the same call.
- **Feature**: if one feature clearly fits, use it. If not, include it as a
  question. The options are the best existing match (or "No feature"), other
  plausible features, and "New feature: <suggested name>".

If nothing is left open, skip the questions and go straight to step 3. That's
common for simple tasks, or when the description already has enough detail. Don't
invent questions to fill a round.

**With Mark**: ask everything in one round of `AskUserQuestion`. That tool takes at
most 4 questions per call, so use back-to-back calls if you have more. Product and
taste questions go first. Put the recommended option first, tagged "(Recommended)",
and make each question make sense on its own. Ask a second round only if his
answers raise a new question. Don't ask him to confirm the draft afterwards.

**Unattended**: answer each question yourself from the caller's context, `CLAUDE.md`,
and `~/Documents/Personal/LifeCoach/pursuits/nexus.md`. Take the option a careful
product owner would most likely pick. A question stays open, and **blocks** the
task, only when it needs Mark:
- work outside the repo: hardware, accounts, credentials, money, anything physical
- a personal call with nothing to go on, like a name or a preference with no hint
  in the docs
- intent too unclear to spec, even after reading the docs
- a wrong answer would destroy data or lock in the API contract for other clients

Unattended runs never create features. Use an existing feature that clearly fits,
or none.

## 3. Write and create the task

**Title**: aim for 2–3 words that sum up the work. Go longer only when you have to,
and never past 10. Match the existing titles, e.g. "Project filtering/sorting" or
"All-day/multiday events".

**Description**: plain text, in this shape. Leave out sections that would be empty.

```
<One short paragraph: what to do and why, in product terms. Mention what already
exists when it matters, e.g. "the calendar modal already shows the project name".>

Repro: <steps>. Expected: <…>. Actual: <…>.     ← bugs only

Decisions:
- <each product/taste answer, and any non-obvious technical choice>
```

Status lines go below a `---` line at the end. The only one this skill writes is
`Needs first: <task title>`, and only when doing this task before that one would
break something. It also writes the `Blocked` line in unattended runs (below). The
conductor adds its own lines later.

**Create it** with `create_task`, using the feature's id if there is one. If Mark
chose a new feature, call `create_feature` first.
- No open questions: leave it `todo`.
- Unattended with blocking questions: create it as `blocked` (`update_task`), with
  one line per question in the status section:
  `Blocked (conductor, <YYYY-MM-DD>): <question>. Options: … Recommended: …`

## 4. Report

- **With Mark**: show the title, feature, status, and description as created, in a
  few lines. He'll tell you if anything should change.
- **Unattended**: end with exactly this line for the caller:

  ```
  add-task: <created todo | created blocked | updated | skipped> — <title> (<task id>)<; blocked on: … | ; duplicate of: … | ; not real: …>
  ```
