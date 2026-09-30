from datetime import datetime, timedelta, timezone as dt_timezone
from functools import wraps

from app.extensions.supabase import supabase
from app.extensions.cache import cache
from app.services import recurrence as rr

EVENT_FIELDS = ["title", "description", "start_at", "end_at", "all_day", "category", "timezone"]
# Non-time fields a master shares with its overrides / split-off series.
DETAIL_FIELDS = ["title", "description", "category", "all_day"]
SCOPES = ("this", "following", "all")


class NotFound(LookupError):
    pass


def parse_instant(value: str) -> datetime:
    """Parse an ISO-8601 instant and normalize to UTC, so that two spellings of
    the same moment share one memoize entry. Raises ValueError if unparseable."""
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=dt_timezone.utc)
    return dt.astimezone(dt_timezone.utc)


def _iso(dt):
    return dt.isoformat() if dt else None


# ---- reads ---------------------------------------------------------------

@cache.memoize()
def get_events(start: str, end: str):
    """Events overlapping the half-open window [start, end): plain rows
    (incl. overrides) plus expanded occurrences of recurring masters.
    Overlap: start_at < end AND end_at > start."""
    start_dt, end_dt = parse_instant(start), parse_instant(end)

    plain = (
        supabase.table("events")
        .select("*")
        .is_("rrule", "null")
        .lt("start_at", end)
        .gt("end_at", start)
        .execute()
    ).data

    masters = (
        supabase.table("events")
        .select("*")
        .not_.is_("rrule", "null")
        .lt("start_at", end)
        .or_(f'recurrence_end_at.is.null,recurrence_end_at.gt."{start}"')
        .execute()
    ).data

    # Overridden occurrences are excluded from expansion even when the
    # override row itself was moved out of the window.
    overridden = {}
    if masters:
        rows = (
            supabase.table("events")
            .select("recurring_event_id,original_start_at")
            .in_("recurring_event_id", [m["id"] for m in masters])
            .execute()
        ).data
        for r in rows:
            overridden.setdefault(r["recurring_event_id"], set()).add(parse_instant(r["original_start_at"]))

    events = []
    for m in masters:
        excluded = overridden.get(m["id"], set()) | {parse_instant(x) for x in m["exdates"] or []}
        occurrences = rr.expand(
            m["rrule"], parse_instant(m["start_at"]), parse_instant(m["end_at"]), m["timezone"],
            start_dt, end_dt, excluded,
        )
        events.extend(_instance(m, occ_start, occ_end) for occ_start, occ_end in occurrences)

    # Overrides carry their master's rrule (UI "repeats" icon / picker preselect).
    rrules = {m["id"]: m["rrule"] for m in masters}
    missing = {r["recurring_event_id"] for r in plain if r["recurring_event_id"]} - rrules.keys()
    if missing:
        rows = supabase.table("events").select("id,rrule").in_("id", list(missing)).execute().data
        rrules.update({r["id"]: r["rrule"] for r in rows})
    for r in plain:
        if r["recurring_event_id"]:
            r["rrule"] = rrules.get(r["recurring_event_id"])
    events.extend(plain)

    events.sort(key=lambda e: parse_instant(e["start_at"]))
    return events


def _instance(master: dict, start: datetime, end: datetime) -> dict:
    """Virtual (unmodified) occurrence of a master."""
    return {
        **master,
        "id": f"{master['id']}_{int(start.timestamp())}",
        "recurring_event_id": master["id"],
        "original_start_at": _iso(start),
        "start_at": _iso(start),
        "end_at": _iso(end),
    }


def _get_event(event_id: str) -> dict:
    res = supabase.table("events").select("*").eq("id", event_id).execute()
    if not res.data:
        raise NotFound(f"event {event_id} not found")
    return res.data[0]


def _check_order(start: datetime, end: datetime):
    if end <= start:
        raise ValueError("end_at must be after start_at")


def _series_fields(body: str, start: datetime, end: datetime, tz: str) -> dict:
    """Master columns for a series. start/end snap to the rule's first
    occurrence so the master always sits on its first occurrence."""
    _check_order(start, end)
    body = rr.normalize_rrule(body, start, tz)
    first = rr.first_occurrence(body, start, tz)
    first_end = first + (end - start)
    return {
        "rrule": body,
        "start_at": _iso(first),
        "end_at": _iso(first_end),
        "recurrence_end_at": _iso(rr.recurrence_end(body, first, first_end, tz)),
    }


# ---- plain event CRUD ----------------------------------------------------

def invalidates_events(fn):
    """Clear the memoized window fetch after a mutation, even a failed one, so
    a partially applied change never leaves stale windows cached."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        finally:
            cache.delete_memoized(get_events)
    return wrapper


@invalidates_events
def create_event(data: dict):
    _check_order(parse_instant(data["start_at"]), parse_instant(data["end_at"]))

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

    if data.get("rrule"):
        row.update(_series_fields(
            data["rrule"], parse_instant(data["start_at"]), parse_instant(data["end_at"]),
            data.get("timezone") or "UTC",
        ))

    res = supabase.table("events").insert(row).execute()

    return res.data[0]

@invalidates_events
def update_event(event_id: str, data: dict):
    updates = {f: data[f] for f in EVENT_FIELDS if f in data}

    # rrule / time changes need the current row to validate and to (re)compute
    # series columns.
    if any(f in data for f in ("rrule", "start_at", "end_at", "timezone")):
        row = _get_event(event_id)
        start = parse_instant(updates.get("start_at") or row["start_at"])
        end = parse_instant(updates.get("end_at") or row["end_at"])
        _check_order(start, end)

        body = (data.get("rrule") or None) if "rrule" in data else row["rrule"]
        if body and row["recurring_event_id"]:
            raise ValueError("an occurrence override cannot have its own rrule")
        if body:
            updates.update(_series_fields(body, start, end, updates.get("timezone") or row["timezone"]))
        elif row["rrule"]:
            updates.update(rrule=None, recurrence_end_at=None)  # master -> plain event

        if row["rrule"] and _series_changed(row, updates):
            updates["exdates"] = []
            _delete_overrides(event_id)

    res = supabase.table("events").update(updates).eq("id", event_id).execute()

    return res.data[0]

@invalidates_events
def delete_event(event_id: str):
    res = supabase.table("events").delete().eq("id", event_id).execute()
    return res.data[0]


# ---- recurring occurrences -----------------------------------------------

def _check_scope(scope):
    if scope not in SCOPES:
        raise ValueError(f"scope must be one of {', '.join(SCOPES)}")


def _get_master(master_id: str, original_start: datetime) -> dict:
    master = _get_event(master_id)
    if not master["rrule"]:
        raise ValueError("event is not recurring")
    if not rr.is_occurrence(master["rrule"], parse_instant(master["start_at"]), master["timezone"], original_start):
        raise ValueError("original_start is not an occurrence of this series")
    return master


def _get_override(master_id: str, original_start: datetime):
    res = (
        supabase.table("events").select("*")
        .eq("recurring_event_id", master_id)
        .eq("original_start_at", _iso(original_start))
        .execute()
    )
    return res.data[0] if res.data else None


def _delete_overrides(master_id: str, from_start: datetime = None):
    """Delete a master's overrides (only those at/after from_start if given)."""
    q = supabase.table("events").delete().eq("recurring_event_id", master_id)
    if from_start:
        q = q.gte("original_start_at", _iso(from_start))
    q.execute()


def _delete_overrides_at(master_id: str, original_start: datetime):
    (
        supabase.table("events").delete()
        .eq("recurring_event_id", master_id)
        .eq("original_start_at", _iso(original_start))
        .execute()
    )


def _delete_master(master_id: str) -> dict:
    return supabase.table("events").delete().eq("id", master_id).execute().data[0]


def _series_changed(master: dict, new: dict) -> bool:
    """Whether `new` (master column updates) changes which instants the series
    produces — if so, exdates and overrides no longer line up with it."""
    return (
        any(parse_instant(new.get(f) or master[f]) != parse_instant(master[f]) for f in ("start_at", "end_at"))
        or new.get("rrule", master["rrule"]) != master["rrule"]
        or new.get("timezone", master["timezone"]) != master["timezone"]
    )


def _changed_details(master: dict, data: dict) -> dict:
    return {f: data[f] for f in DETAIL_FIELDS if f in data and data[f] != master[f]}


def _current_times(master: dict, original_start: datetime, override):
    """Where an instance currently is: its override row's times, if any."""
    if override:
        return parse_instant(override["start_at"]), parse_instant(override["end_at"])
    duration = parse_instant(master["end_at"]) - parse_instant(master["start_at"])
    return original_start, original_start + duration


def _instance_edit(master: dict, original_start: datetime, override, data: dict):
    """Measure an instance edit against the instance's CURRENT times, so saving
    an already-moved override without touching its times shifts nothing.
    Returns (wall-clock shift to apply to the series, new series duration)."""
    cur_start, cur_end = _current_times(master, original_start, override)
    new_start = parse_instant(data["start_at"]) if data.get("start_at") else cur_start
    new_end = parse_instant(data["end_at"]) if data.get("end_at") else new_start + (cur_end - cur_start)
    _check_order(new_start, new_end)

    series_duration = parse_instant(master["end_at"]) - parse_instant(master["start_at"])
    duration = series_duration + (new_end - new_start) - (cur_end - cur_start)
    if duration <= timedelta(0):
        raise ValueError("edit would give the series a non-positive duration")
    return rr.wall_delta(cur_start, new_start, master["timezone"]), duration


def _requested_rule(master: dict, data: dict):
    """(rule, explicit): the body's rrule when it differs from the master's
    (None = does not repeat), else the master's own rule with explicit=False."""
    if "rrule" not in data:
        return master["rrule"], False
    requested = data["rrule"] or None
    if requested and rr.parse_rule(requested) == rr.parse_rule(master["rrule"]):
        return master["rrule"], False
    return requested, True


@invalidates_events
def update_occurrence(master_id: str, original_start: datetime, data: dict):
    scope = data.get("scope")
    _check_scope(scope)
    master = _get_master(master_id, original_start)
    override = _get_override(master_id, original_start)

    if scope == "this":
        return _update_this(master, original_start, override, data)
    if scope == "following" and original_start != parse_instant(master["start_at"]):
        return _update_following(master, original_start, override, data)
    return _update_all(master, original_start, override, data)


def _update_this(master, original_start, override, data):
    updates = {f: data[f] for f in EVENT_FIELDS if f in data}  # rrule ignored for "this"
    cur_start, cur_end = _current_times(master, original_start, override)
    _check_order(
        parse_instant(updates["start_at"]) if updates.get("start_at") else cur_start,
        parse_instant(updates["end_at"]) if updates.get("end_at") else cur_end,
    )

    if not updates:
        row = override or _instance(master, cur_start, cur_end)
    elif override:
        row = supabase.table("events").update(updates).eq("id", override["id"]).execute().data[0]
    else:
        new_row = {f: master[f] for f in DETAIL_FIELDS + ["timezone"]}
        new_row.update(
            start_at=_iso(cur_start),
            end_at=_iso(cur_end),
            recurring_event_id=master["id"],
            original_start_at=_iso(original_start),
        )
        new_row.update(updates)
        row = supabase.table("events").insert(new_row).execute().data[0]

    return {**row, "rrule": master["rrule"]}


def _update_all(master, original_start, override, data):
    shift, duration = _instance_edit(master, original_start, override, data)
    tz = data.get("timezone") or master["timezone"]
    old_start = parse_instant(master["start_at"])
    series_start = rr.shift_wall(old_start, shift, master["timezone"])
    series_end = series_start + duration

    body, explicit = _requested_rule(master, data)
    if body and not explicit:
        body = rr.shift_rule_days(body, old_start, series_start, master["timezone"])

    details = _changed_details(master, data)
    updates = {**details, "timezone": tz}
    if body:
        updates.update(_series_fields(body, series_start, series_end, tz))
    else:
        # rrule cleared: the series collapses into a plain event.
        updates.update(rrule=None, recurrence_end_at=None,
                       start_at=_iso(series_start), end_at=_iso(series_end))

    if _series_changed(master, updates):
        updates["exdates"] = []
        _delete_overrides(master["id"])
    elif details:
        supabase.table("events").update(details).eq("recurring_event_id", master["id"]).execute()

    return supabase.table("events").update(updates).eq("id", master["id"]).execute().data[0]


def _update_following(master, split_at, override, data):
    shift, duration = _instance_edit(master, split_at, override, data)
    tz = data.get("timezone") or master["timezone"]
    old_start = parse_instant(master["start_at"])
    old_duration = parse_instant(master["end_at"]) - old_start
    new_start = rr.shift_wall(split_at, shift, master["timezone"])
    new_end = new_start + duration

    truncated, remaining = rr.truncate(master["rrule"], old_start, master["timezone"], split_at)

    body, explicit = _requested_rule(master, data)
    if body and not explicit:
        # Continue the old rule (COUNT -> remaining), re-aimed if moved to another day.
        body = rr.shift_rule_days(rr.continuation_rule(body, remaining), split_at, new_start, master["timezone"])

    # Overrides / exdates only still line up if the series isn't moved or re-ruled.
    carry_over = (not explicit and shift == timedelta(0) and duration == old_duration
                  and tz == master["timezone"])

    details = _changed_details(master, data)
    exdates_before, exdates_after = rr.partition_instants(
        [parse_instant(x) for x in master["exdates"] or []], split_at)

    new_row = {f: master[f] for f in DETAIL_FIELDS}
    new_row.update(details, timezone=tz)
    if body:
        new_row.update(_series_fields(body, new_start, new_end, tz))
        new_row["exdates"] = [_iso(x) for x in exdates_after] if carry_over else []
    else:
        new_row.update(start_at=_iso(new_start), end_at=_iso(new_end))
    new_master = supabase.table("events").insert(new_row).execute().data[0]

    if carry_over:
        (
            supabase.table("events")
            .update({**details, "recurring_event_id": new_master["id"]})
            .eq("recurring_event_id", master["id"])
            .gte("original_start_at", _iso(split_at))
            .execute()
        )
    else:
        _delete_overrides(master["id"], split_at)

    supabase.table("events").update({
        "rrule": truncated,
        "recurrence_end_at": _iso(rr.recurrence_end(truncated, old_start, old_start + old_duration, master["timezone"])),
        "exdates": [_iso(x) for x in exdates_before],
    }).eq("id", master["id"]).execute()

    return new_master


@invalidates_events
def delete_occurrence(master_id: str, original_start: datetime, scope: str):
    """Returns the master row as updated, or as deleted when nothing is left."""
    _check_scope(scope)
    master = _get_master(master_id, original_start)
    old_start = parse_instant(master["start_at"])
    tz = master["timezone"]

    if scope == "all" or (scope == "following" and original_start == old_start):
        return _delete_master(master_id)

    if scope == "this":
        rule = master["rrule"]
        exdates = [parse_instant(x) for x in master["exdates"] or []]
        if original_start not in exdates:
            exdates.append(original_start)
        _delete_overrides_at(master_id, original_start)
        updates = {"exdates": [_iso(x) for x in sorted(exdates)]}
    else:  # following
        rule, _ = rr.truncate(master["rrule"], old_start, tz, original_start)
        exdates, _ = rr.partition_instants([parse_instant(x) for x in master["exdates"] or []], original_start)
        _delete_overrides(master_id, original_start)
        updates = {
            "rrule": rule,
            "recurrence_end_at": _iso(rr.recurrence_end(rule, old_start, parse_instant(master["end_at"]), tz)),
            "exdates": [_iso(x) for x in exdates],
        }

    # Every remaining occurrence cancelled -> drop the series. (Overridden
    # occurrences aren't exdates, so a series with overrides always survives.)
    if not rr.has_visible_occurrence(rule, old_start, tz, exdates):
        return _delete_master(master_id)
    return supabase.table("events").update(updates).eq("id", master_id).execute().data[0]
