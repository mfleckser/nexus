from datetime import UTC, datetime

from app import validation as v
from app.errors import first_row
from app.extensions.cache import cache
from app.extensions.supabase import supabase

TASKS_ALL_KEY = "tasks:all"

# Matches the tasks.status_check constraint.
TASK_STATUSES = ("todo", "active", "complete", "cancelled")
CREATE_FIELDS = ("title", "description", "due_at", "project_id", "feature_id")
UPDATE_FIELDS = (*CREATE_FIELDS, "status")


def _validate(fields: dict):
    v.check_title(fields)
    v.check_text(fields, "description")
    v.check_instant(fields, "due_at")
    v.check_choice(fields, "status", TASK_STATUSES)
    # Malformed ids are rejected by Postgres (22P02 -> 400).
    v.check_text(fields, "project_id")
    v.check_text(fields, "feature_id")


@cache.cached(key_prefix=TASKS_ALL_KEY)
def get_all_tasks():
    res = supabase.table("tasks").select("*").execute()

    return res.data


def get_task(task_id: str):
    res = supabase.table("tasks").select("*").eq("id", task_id).execute()
    return first_row(res.data, f"task {task_id}")


def create_task(data: dict):
    v.require(data, "title")
    row = v.pick(data, CREATE_FIELDS)
    _validate(row)

    res = supabase.table("tasks").insert(row).execute()

    cache.delete(TASKS_ALL_KEY)

    return res.data[0]


def update_task(task_id: str, data: dict):
    updates = v.pick(data, UPDATE_FIELDS)
    _validate(updates)
    if not updates:
        return get_task(task_id)

    if updates.get("status") == "complete":
        updates["completed_at"] = str(datetime.now(UTC))

    res = supabase.table("tasks").update(updates).eq("id", task_id).execute()

    cache.delete(TASKS_ALL_KEY)

    return first_row(res.data, f"task {task_id}")


def delete_task(task_id: str):
    res = supabase.table("tasks").delete().eq("id", task_id).execute()
    cache.delete(TASKS_ALL_KEY)
    return first_row(res.data, f"task {task_id}")
