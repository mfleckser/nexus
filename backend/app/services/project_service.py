from app.extensions.supabase import supabase
from app.extensions.cache import cache

def get_all_projects():
    res = supabase.table("projects").select("id", "created_at", "updated_at", "title", "description", "type", "status", "show_tasks_in_main_view", "notes_updated_at").execute()

    return res.data

def create_project(data: dict):
    res = supabase.table("projects").insert({
        "title": data["title"],
        "description": data.get("description"),
        "type": data.get("type"),
    }).execute()

    return res.data[0]

def update_project(project_id: str, data: dict):
    fields = ["title", "description", "type", "status", "show_tasks_in_main_view"]
    updates = {f: data[f] for f in fields if f in data}

    res = supabase.table("projects").update(updates).eq("id", project_id).execute()

    return res.data[0]

def delete_project(project_id: str):
    res = supabase.table("projects").delete().eq("id", project_id).execute()
    return res.data[0]

def get_project_features(project_id: str):
    res = supabase.table("features").select("id", "created_at", "updated_at", "project_id", "name", "notes_updated_at").eq("project_id", project_id).execute()

    return res.data

def create_feature(project_id: str, data: dict):
    res = supabase.table("features").insert({
        "name": data["name"],
        "project_id": project_id
    }).execute()
    
    return res.data[0]

def delete_feature(feature_id: str):
    res = supabase.table("features").delete().eq("id", feature_id).execute()
    return res.data[0]