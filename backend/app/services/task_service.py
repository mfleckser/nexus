from app.extensions.supabase import supabase
from app.extensions.cache import cache
from datetime import datetime, timezone

TASKS_ALL_KEY = "tasks:all"

@cache.cached(key_prefix=TASKS_ALL_KEY)
def get_all_tasks():
    res = supabase.table("tasks").select("*").execute()

    return res.data

def create_task(data: dict):
    res = supabase.table("tasks").insert({
        "title": data["title"],
        "description": data.get("description"),
        "due_at": data.get("due_at"),
        "project_id": data.get("project_id"),
        "feature_id": data.get("feature_id")
    }).execute()

    cache.delete(TASKS_ALL_KEY)

    return res.data[0]

def update_task(task_id: str, data: dict):
    updates = {}
    fields = ["title", "description", "due_at", "status", "project_id", "feature_id"]

    updates = {f: data[f] for f in fields if f in data}
    if updates.get("status") == "complete":
        updates["completed_at"] = str(datetime.now(timezone.utc))

    res = supabase.table("tasks").update(updates).eq("id", task_id).execute()

    cache.delete(TASKS_ALL_KEY)

    return res.data[0]

def delete_task(task_id: str):
    res = supabase.table("tasks").delete().eq("id", task_id).execute()
    cache.delete(TASKS_ALL_KEY)
    return res.data[0]
