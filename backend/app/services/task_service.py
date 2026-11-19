from datetime import UTC, datetime

from app import validation as v
from app.errors import first_row
from app.extensions import cache as c
from app.extensions.supabase import supabase

# Matches the tasks.status_check constraint.
TASK_STATUSES = ("todo", "active", "blocked", "complete", "cancelled")
CREATE_FIELDS = ("title", "description", "due_at", "project_id", "feature_id", "event_id")
UPDATE_FIELDS = (*CREATE_FIELDS, "status")


def _validate(fields: dict):
    v.check_title(fields)
    v.check_text(fields, "description")
    v.check_instant(fields, "due_at")
    v.check_choice(fields, "status", TASK_STATUSES)
    # Malformed ids are rejected by Postgres (22P02 -> 400).
    v.check_text(fields, "project_id")
    v.check_text(fields, "feature_id")
    # An event row id (plain event, series master or override), not a virtual
    # occurrence id. Deleting the event nulls it (FK on delete set null).
    v.check_text(fields, "event_id")


def get_all_tasks():
    """All tasks, oldest first (id breaks created_at ties) so the order is stable."""

    def load():
        return supabase.table("tasks").select("*").order("created_at").order("id").execute().data

    return c.get_or_load(c.TASKS, load)


def list_tasks(args) -> list:
    """GET /tasks, optionally filtered by project_id, feature_id and status (a
    comma-separated list). Filters run over the cached full list."""
    tasks = get_all_tasks()
    statuses = None
    if "status" in args:
        statuses = {s.strip() for s in args["status"].split(",")}
        for status in statuses:
            v.check_choice({"status": status}, "status", TASK_STATUSES)
    return [
        t
        for t in tasks
        if all(t.get(name) == args[name] for name in ("project_id", "feature_id") if name in args)
        and (statuses is None or t["status"] in statuses)
    ]


def get_task(task_id: str):
    res = supabase.table("tasks").select("*").eq("id", task_id).execute()
    return first_row(res.data, f"task {task_id}")


def create_task(data: dict):
    v.require(data, "title")
    row = v.pick(data, CREATE_FIELDS)
    _validate(row)
    row["created_via"] = v.created_via()

    res = supabase.table("tasks").insert(row).execute()

    c.invalidate(c.TASKS)

    return res.data[0]


def update_task(task_id: str, data: dict):
    updates = v.pick(data, UPDATE_FIELDS)
    _validate(updates)
    if not updates:
        return get_task(task_id)

    if "status" in updates:
        if updates["status"] != "complete":
            updates["completed_at"] = None
        elif get_task(task_id)["status"] != "complete":
            # Stamp only the transition, so re-saving a complete task keeps its time.
            updates["completed_at"] = datetime.now(UTC).isoformat()

    res = supabase.table("tasks").update(updates).eq("id", task_id).execute()

    c.invalidate(c.TASKS)

    return first_row(res.data, f"task {task_id}")


def delete_task(task_id: str):
    res = supabase.table("tasks").delete().eq("id", task_id).execute()
    c.invalidate(c.TASKS)
    return first_row(res.data, f"task {task_id}")
