from app.extensions.supabase import supabase

def get_all_events():
    res = supabase.table("events").select("*").execute()

    return res.data

def create_event(data: dict):
    res = supabase.table("events").insert({
        "title": data["title"],
        "description": data.get("description"),
        "start_at": data["start_at"],
        "end_at": data["end_at"],
        "category": data.get("category"),
        "all_day": data.get("all_day")
    }).execute()

    return res.data[0]

def update_event(event_id: str, data: dict):
    updates = {}
    fields = ["title", "description", "start_at", "end_at", "all_day"]

    updates = {f: data[f] for f in fields if f in data}

    res = supabase.table("events").update(updates).eq("id", event_id).execute()

    return res.data[0]
