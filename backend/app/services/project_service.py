from app import validation as v
from app.errors import first_row
from app.extensions import cache as c
from app.extensions.supabase import supabase

# The choices ProjectModal offers. The DB column is free text; "" from the
# form means "none" and is stored as null.
PROJECT_TYPES = ("coding", "learning", "fitness", "other")
PROJECT_STATUSES = ("planning", "active", "paused", "complete", "archived")
CREATE_FIELDS = ("title", "description", "type")
UPDATE_FIELDS = (*CREATE_FIELDS, "status", "show_tasks_in_main_view", "notes")
# List views leave out the (large) notes columns; they have their own endpoint.
PROJECT_LIST_COLUMNS = (
    "id", "created_at", "updated_at", "title", "description", "type", "status",
    "show_tasks_in_main_view", "notes_updated_at",
)  # fmt: skip
FEATURE_LIST_COLUMNS = ("id", "created_at", "updated_at", "project_id", "name", "notes_updated_at")


def _validate(fields: dict):
    """Validate in place; normalizes "" type/status to null."""
    for name in ("type", "status"):
        if fields.get(name) == "":
            fields[name] = None
    v.check_title(fields)
    v.check_text(fields, "description", nullable=False)
    v.check_choice(fields, "type", PROJECT_TYPES, nullable=True)
    v.check_choice(fields, "status", PROJECT_STATUSES, nullable=True)
    v.check_bool(fields, "show_tasks_in_main_view", nullable=False)
    v.check_text(fields, "notes")


def get_all_projects():
    return c.get_or_load(c.PROJECTS, lambda: supabase.table("projects").select(*PROJECT_LIST_COLUMNS).execute().data)


def get_project(project_id: str):
    res = supabase.table("projects").select("*").eq("id", project_id).execute()
    return first_row(res.data, f"project {project_id}")


def get_project_notes(project_id: str):
    def load():
        res = supabase.table("projects").select("notes").eq("id", project_id).execute()
        return first_row(res.data, f"project {project_id}")

    return c.get_or_load(c.project_notes(project_id), load)


def create_project(data: dict):
    v.require(data, "title")
    row = {"description": "", **v.pick(data, CREATE_FIELDS)}
    _validate(row)

    res = supabase.table("projects").insert(row).execute()

    c.invalidate(c.PROJECTS)

    return res.data[0]


def update_project(project_id: str, data: dict):
    updates = v.pick(data, UPDATE_FIELDS)
    _validate(updates)
    if not updates:
        return get_project(project_id)

    res = supabase.table("projects").update(updates).eq("id", project_id).execute()

    # The list carries notes_updated_at, so notes edits invalidate it too.
    c.invalidate(c.PROJECTS, c.project_notes(project_id))

    return first_row(res.data, f"project {project_id}")


def delete_project(project_id: str):
    res = supabase.table("projects").delete().eq("id", project_id).execute()
    # Features cascade; tasks.project_id / feature_id are set null.
    c.invalidate(c.PROJECTS, c.project_notes(project_id), c.project_features(project_id), c.TASKS)
    return first_row(res.data, f"project {project_id}")


def get_project_features(project_id: str):
    def load():
        return supabase.table("features").select(*FEATURE_LIST_COLUMNS).eq("project_id", project_id).execute().data

    return c.get_or_load(c.project_features(project_id), load)


def create_feature(project_id: str, data: dict):
    v.require(data, "name")
    v.check_title(data, "name")

    res = supabase.table("features").insert({"name": data["name"], "project_id": project_id}).execute()

    c.invalidate(c.project_features(project_id))

    return res.data[0]


def delete_feature(feature_id: str):
    res = supabase.table("features").delete().eq("id", feature_id).execute()
    feature = first_row(res.data, f"feature {feature_id}")
    # tasks.feature_id is set null.
    c.invalidate(c.project_features(feature["project_id"]), c.TASKS)
    return feature
