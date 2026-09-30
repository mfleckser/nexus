from datetime import datetime, timezone as dt_timezone

from app.extensions.supabase import supabase
from app.extensions.cache import cache

EVENT_FIELDS = ["title", "description", "start_at", "end_at", "all_day", "category", "timezone"]


def parse_instant(value: str) -> datetime:
    """Parse an ISO-8601 instant and normalize to UTC, so that two spellings of
    the same moment share one memoize entry. Raises ValueError if unparseable."""
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=dt_timezone.utc)
    return dt.astimezone(dt_timezone.utc)


@cache.memoize()
def get_events(start: str, end: str):
    """Events overlapping the half-open window [start, end):
    an event overlaps iff start_at < end AND end_at > start."""
    res = (
        supabase.table("events")
        .select("*")
        .lt("start_at", end)
        .gt("end_at", start)
        .order("start_at")
        .execute()
    )

    return res.data

def create_event(data: dict):
    row = {
        "title": data["title"],
        "description": data.get("description"),
        "start_at": data["start_at"],
        "end_at": data["end_at"],
        "category": data.get("category"),
        "all_day": data.get("all_day")
    }

    # timezone is NOT NULL with a default — omit the key entirely when the
    # client didn't send one, rather than sending an explicit null (23502).
    if data.get("timezone"):
        row["timezone"] = data["timezone"]

    res = supabase.table("events").insert(row).execute()

    cache.delete_memoized(get_events)

    return res.data[0]

def update_event(event_id: str, data: dict):
    updates = {f: data[f] for f in EVENT_FIELDS if f in data}

    res = supabase.table("events").update(updates).eq("id", event_id).execute()

    cache.delete_memoized(get_events)

    return res.data[0]

def delete_event(event_id: str):
    res = supabase.table("events").delete().eq("id", event_id).execute()
    cache.delete_memoized(get_events)
    return res.data[0]
