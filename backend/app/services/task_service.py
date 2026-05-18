from app.extensions.supabase import supabase
from datetime import datetime, timezone

def get_all_tasks():
    res = supabase.table("tasks").select("*").execute()

    return res.data

def create_task(data: dict):
    res = supabase.table("tasks").insert({
        "title": data["title"],
        "description": data.get("description"),
        "due_at": data.get("due_at"),
    }).execute()

    return res.data[0]

def update_task(task_id: str, data: dict):
    updates = {}
    fields = ["title", "description", "due_at", "status"]

    updates = {f: data[f] for f in fields if f in data}
    if updates.get("status") == "complete":
        updates["completed_at"] = str(datetime.now(timezone.utc))

    res = supabase.table("tasks").update(updates).eq("id", task_id).execute()

    return res.data[0]

def delete_task(task_id: str):
    res = supabase.table("tasks").delete().eq("id", task_id).execute()
    return res.data[0]
