from app.extensions.supabase import supabase

def get_all_tasks():
    res = supabase.table("tasks").select("*").execute()

    return res.data

def create_task(data: dict):
    res = supabase.table("tasks").insert({
        "title": data["title"],
        "description": data.get("description"),
        "due_at": data.get("due_date"),
    }).execute()

    return res.data[0]