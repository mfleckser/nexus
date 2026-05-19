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
        "all_day": data.get("all_day")
    }).execute()

    return res.data[0]
