import threading
import uuid
from datetime import datetime, timedelta
from functools import wraps

from supabase import PostgrestAPIError

from app import validation as v
from app.errors import NotFound, ValidationError, first_row
from app.extensions.cache import TASKS, cache, invalidate
from app.extensions.supabase import supabase
from app.services import recurrence as rr
from app.validation import parse_instant

EVENT_FIELDS = ["title", "description", "start_at", "end_at", "all_day", "category", "timezone"]
# Non-time fields a master shares with its overrides / split-off series.
DETAIL_FIELDS = ["title", "description", "category", "all_day"]
SCOPES = ("this", "following", "all")


def _iso(dt):
    return dt.isoformat() if dt else None


def _validate(data: dict):
    """Type checks for the event fields present in a request body."""
    v.check_title(data)
    v.check_text(data, "description")
    v.check_text(data, "category")
    v.check_bool(data, "all_day")
    v.check_instant(data, "start_at", nullable=False)
    v.check_instant(data, "end_at", nullable=False)
    v.check_timezone(data)
    v.check_text(data, "rrule")  # semantics checked by rr.normalize_rrule


# ---- reads ---------------------------------------------------------------


@cache.memoize()
def get_events(start: str, end: str):
    """Events overlapping the half-open window [start, end): plain rows
    (incl. overrides) plus expanded occurrences of recurring masters.
    Overlap: start_at < end AND end_at > start."""
    start_dt, end_dt = parse_instant(start), parse_instant(end)

    plain = (
        supabase.table("events").select("*").is_("rrule", "null").lt("start_at", end).gt("end_at", start).execute()
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
            m["rrule"],
            parse_instant(m["start_at"]),
            parse_instant(m["end_at"]),
            m["timezone"],
            start_dt,
            end_dt,
            excluded,
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
    return first_row(res.data, f"event {event_id}")


def _check_order(start: datetime, end: datetime):
    if end <= start:
        raise ValidationError("end_at must be after start_at")


def _series_fields(body: str, start: datetime, end: datetime, tz: str) -> dict:
    """Master columns for a series. start/end snap to the rule's first
    occurrence so the master always sits on its first occurrence."""
    _check_order(start, end)
    body = rr.normalize_rrule(body, start, tz)
    first = rr.first_occurrence(body, start, tz)
    first_end = rr.occurrence_end(first, start, end, tz)
    return {
        "rrule": body,
        "start_at": _iso(first),
        "end_at": _iso(first_end),
        "recurrence_end_at": _iso(rr.recurrence_end(body, first, first_end, tz)),
    }


# ---- plain event CRUD ----------------------------------------------------


# Event writes read a row, compute and write it back (e.g. appending an exdate),
# so two at once could lose one. Serialize them: one gunicorn worker means one
# process (see CLAUDE.md, Caching).
_write_lock = threading.Lock()


def invalidates_events(fn):
    """Serialize a mutation and clear the memoized window fetch after it, even
    after a failed one."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            with _write_lock:
                return fn(*args, **kwargs)
        finally:
            cache.delete_memoized(get_events)
            # Deleting an event row (plain, master or override) nulls
            # tasks.event_id via its FK; many paths delete rows, so always clear.
            invalidate(TASKS)

    return wrapper


@invalidates_events
def create_event(data: dict):
    v.require(data, "title", "start_at", "end_at")
    _validate(data)
    _check_order(parse_instant(data["start_at"]), parse_instant(data["end_at"]))

    # timezone is omitted (-> column default UTC) when the client didn't send one.
    row = v.pick(data, EVENT_FIELDS)

    if data.get("rrule"):
        row.update(
            _series_fields(
                data["rrule"],
                parse_instant(data["start_at"]),
                parse_instant(data["end_at"]),
                data.get("timezone") or "UTC",
            )
        )

    res = supabase.table("events").insert(row).execute()

    return res.data[0]


@invalidates_events
def update_event(event_id: str, data: dict):
    _validate(data)
    updates = v.pick(data, EVENT_FIELDS)
    if not updates and "rrule" not in data:
        return _get_event(event_id)

    # rrule / time changes need the current row to validate and to (re)compute
    # series columns.
    if any(f in data for f in ("rrule", "start_at", "end_at", "timezone")):
        row = _get_event(event_id)
        if row["rrule"]:
            # A master's times are its first occurrence's: same as an "all" edit there.
            return _update_all(row, parse_instant(row["start_at"]), None, data)
        start = parse_instant(updates.get("start_at") or row["start_at"])
        end = parse_instant(updates.get("end_at") or row["end_at"])
        _check_order(start, end)

        body = (data.get("rrule") or None) if "rrule" in data else row["rrule"]
        if body and row["recurring_event_id"]:
            raise ValidationError("an occurrence override cannot have its own rrule")
        if body:
            updates.update(_series_fields(body, start, end, updates.get("timezone") or row["timezone"]))

    res = supabase.table("events").update(updates).eq("id", event_id).execute()

    return first_row(res.data, f"event {event_id}")


@invalidates_events
def delete_event(event_id: str):
    row = _get_event(event_id)
    if row["recurring_event_id"]:
        # An override stands in for one occurrence: cancel that occurrence, as
        # DELETE .../occurrences/<start>?scope=this does, or the series would
        # show it again. Returns the deleted override row.
        _cancel_occurrence(_get_event(row["recurring_event_id"]), parse_instant(row["original_start_at"]))
        return row
    res = supabase.table("events").delete().eq("id", event_id).execute()
    return first_row(res.data, f"event {event_id}")


# ---- recurring occurrences -----------------------------------------------


def _check_scope(scope):
    if scope not in SCOPES:
        raise ValidationError(f"scope must be one of {', '.join(SCOPES)}")


def _get_master(master_id: str, original_start: datetime) -> dict:
    master = _get_event(master_id)
    if not master["rrule"]:
        raise ValidationError("event is not recurring")
    if not rr.is_occurrence(master["rrule"], parse_instant(master["start_at"]), master["timezone"], original_start):
        raise ValidationError("original_start is not an occurrence of this series")
    return master


def _at_occurrence(query, master_id: str, original_start: datetime):
    """Narrow a query to the override row of one occurrence."""
    return query.eq("recurring_event_id", master_id).eq("original_start_at", _iso(original_start))


def _get_override(master_id: str, original_start: datetime):
    res = _at_occurrence(supabase.table("events").select("*"), master_id, original_start).execute()
    return res.data[0] if res.data else None


def _overrides(master_id: str, from_start: datetime = None) -> list:
    """A master's override rows (only those at/after from_start if given)."""
    q = supabase.table("events").select("*").eq("recurring_event_id", master_id)
    if from_start:
        q = q.gte("original_start_at", _iso(from_start))
    return q.execute().data


def _delete_master(master_id: str) -> dict:
    return first_row(supabase.table("events").delete().eq("id", master_id).execute().data, f"event {master_id}")


# ---- atomic multi-row writes ---------------------------------------------
# A recurring edit changes a master, its overrides and maybe a split-off
# series. Its writes are collected as ops and sent in one apply_event_writes
# RPC call (one transaction), so a failure never leaves half an edit behind.


def _apply(ops: list, result_id: str = None):
    """Run the ops in one transaction; returns row `result_id` as it stands
    afterwards (None if not given or deleted)."""
    try:
        res = supabase.rpc("apply_event_writes", {"ops": ops, "result_id": result_id}).execute()
    except PostgrestAPIError as e:
        if e.code == "P0002":  # an updated row vanished mid-edit
            raise NotFound(e.message) from None
        raise
    return res.data[0] if res.data else None


def _update_op(event_id: str, fields: dict) -> dict:
    return {"op": "update", "id": event_id, "set": fields}


def _delete_overrides_op(master_id: str, from_start: datetime = None, at: datetime = None) -> dict:
    return {"op": "delete_overrides", "master": master_id, "from": _iso(from_start), "at": _iso(at)}


def _carry_exceptions(old: dict, new_id: str, new: dict, move: dict):
    """Move a series' exceptions along when the series itself moves, so cancelled
    occurrences stay cancelled and edited ones stay edited.

    old     the master as it was
    new_id  the series receiving the exceptions (the master, or a split-off series)
    new     its new columns (rrule/start_at/end_at/timezone)
    move    anchor     (old instant, new instant) of the edited slot
            explicit   whether the edit set a new rule (else it's re-aimed)
            exdates    old exdates to carry
            overrides  old override rows to carry
            details    changed detail fields, set on every carried override
            clicked    (override id, fields) for the override edited, or None
            skip_before  old occurrences before this belong to the other half

    Returns (exdates for the new series, ops for the overrides)."""
    old_tz, tz = old["timezone"], new["timezone"]
    overrides = move["overrides"]
    slot_map = _slot_map(
        old,
        new,
        move,
        [*move["exdates"], *(parse_instant(o["original_start_at"]) for o in overrides)],
    )
    old_duration = _wall_duration(old)
    new_duration = rr.wall_delta(parse_instant(new["start_at"]), parse_instant(new["end_at"]), tz)

    exdates = sorted({x for x in map(slot_map, move["exdates"]) if x})

    ops, taken = [], set()
    for ov in overrides:
        slot = parse_instant(ov["original_start_at"])
        new_slot = slot_map(slot)
        if not new_slot or new_slot in taken:
            ops.append({"op": "delete", "id": ov["id"]})
            continue
        taken.add(new_slot)
        # A moved override keeps its offset from its slot; one with the series'
        # length takes the new length, a custom length stays.
        ov_start, ov_end = parse_instant(ov["start_at"]), parse_instant(ov["end_at"])
        moved_start = rr.shift_wall(ov_start, rr.wall_delta(slot, new_slot, old_tz, tz), old_tz, tz)
        length = rr.wall_delta(ov_start, ov_end, old_tz)
        moved_end = rr.shift_wall(moved_start, new_duration if length == old_duration else length, tz)

        fields = {
            "recurring_event_id": new_id,
            "original_start_at": _iso(new_slot),
            "start_at": _iso(moved_start),
            "end_at": _iso(moved_end),
            **move["details"],
        }
        if ov["timezone"] == old_tz:
            fields["timezone"] = tz
        if move["clicked"] and ov["id"] == move["clicked"][0]:
            fields.update(move["clicked"][1])
        changed = {k: val for k, val in fields.items() if not _same(k, val, ov[k])}
        if changed:
            ops.append(_update_op(ov["id"], changed))
    return [_iso(x) for x in exdates], ops


def _slot_map(old: dict, new: dict, move: dict, instants):
    """old occurrence start -> its start in the new series, or None if the new
    series doesn't have it.

    Each instant moves by the edited slot's wall-clock shift if that lands on
    an occurrence of the new rule. When the rule was only re-aimed and the
    shift misses (2nd Tuesday -> 2nd Wednesday in a month starting on a
    Wednesday, month ends, a COUNT continuation), occurrences pair up by
    position instead."""
    old_tz, tz = old["timezone"], new["timezone"]
    new_start = parse_instant(new["start_at"])
    anchor = move["anchor"]
    delta = rr.wall_delta(anchor[0], anchor[1], old_tz, tz)

    def shifted(x):
        moved = rr.shift_wall(x, delta, old_tz, tz)
        return moved if rr.is_occurrence(new["rrule"], new_start, tz, moved) else None

    if move["explicit"]:
        return shifted
    pairs = rr.pair_occurrences(
        (old["rrule"], parse_instant(old["start_at"]), old_tz),
        (new["rrule"], new_start, tz),
        instants,
        move.get("skip_before"),
    )
    return lambda x: shifted(x) or pairs.get(x)


def _same(col: str, a, b) -> bool:
    if col in ("start_at", "end_at", "original_start_at") and a and b:
        return parse_instant(a) == parse_instant(b)
    return a == b


def _exdates(master: dict) -> list:
    return [parse_instant(x) for x in master["exdates"] or []]


def _clicked(override, data: dict, times):
    """The clicked (overridden) occurrence lands exactly at the edited times and
    gets every detail field sent, even ones equal to the series value that
    _changed_details leaves out."""
    if not override:
        return None
    return override["id"], {**v.pick(data, DETAIL_FIELDS), "start_at": _iso(times[0]), "end_at": _iso(times[1])}


def _changed_details(master: dict, data: dict) -> dict:
    return {f: data[f] for f in DETAIL_FIELDS if f in data and data[f] != master[f]}


def _current_times(master: dict, original_start: datetime, override):
    """Where an instance currently is: its override row's times, if any."""
    if override:
        return parse_instant(override["start_at"]), parse_instant(override["end_at"])
    end = rr.occurrence_end(
        original_start, parse_instant(master["start_at"]), parse_instant(master["end_at"]), master["timezone"]
    )
    return original_start, end


def _instance_edit(master: dict, original_start: datetime, override, data: dict):
    """Measure an instance edit against the instance's CURRENT times, so saving
    an already-moved override without touching its times shifts nothing.
    Returns (wall-clock shift to apply to the series, new series wall-clock
    duration, the instance's edited (start, end)), the first two measured in the master's timezone so that an instance
    whose absolute length differs by a DST offset doesn't skew the series."""
    cur_start, cur_end = _current_times(master, original_start, override)
    new_start, new_end = _edited_times(cur_start, cur_end, data)

    tz = master["timezone"]
    duration = _wall_duration(master) + rr.wall_delta(new_start, new_end, tz) - rr.wall_delta(cur_start, cur_end, tz)
    if duration <= timedelta(0):
        raise ValidationError("edit would give the series a non-positive duration")
    return rr.wall_delta(cur_start, new_start, tz), duration, (new_start, new_end)


def _edited_times(cur_start: datetime, cur_end: datetime, data: dict):
    """An instance's times after the edit. A missing start_at / end_at means
    "unchanged" (as for "this" and plain events)."""
    new_start = parse_instant(data["start_at"]) if data.get("start_at") else cur_start
    new_end = parse_instant(data["end_at"]) if data.get("end_at") else cur_end
    _check_order(new_start, new_end)
    return new_start, new_end


def _wall_duration(master: dict) -> timedelta:
    return rr.wall_delta(parse_instant(master["start_at"]), parse_instant(master["end_at"]), master["timezone"])


def _requested_rule(master: dict, data: dict):
    """(rule, explicit): the body's rrule when it differs from the master's
    (None = does not repeat), else the master's own rule with explicit=False."""
    if "rrule" not in data:
        return master["rrule"], False
    requested = data["rrule"] or None
    if requested:
        # Compare canonical forms, so an equivalent spelling isn't a new rule.
        start, tz = parse_instant(master["start_at"]), master["timezone"]
        if _rule_key(rr.normalize_rrule(requested, start, tz)) == _rule_key(master["rrule"]):
            return master["rrule"], False
    return requested, True


def _rule_key(body: str) -> dict:
    parts = rr.parse_rule(body)
    if parts.get("INTERVAL") == "1":
        del parts["INTERVAL"]  # the default
    return parts


@invalidates_events
def update_occurrence(master_id: str, original_start: datetime, data: dict):
    scope = data.get("scope")
    _check_scope(scope)
    _validate(data)
    master = _get_master(master_id, original_start)
    if original_start in _exdates(master):
        raise NotFound("occurrence was cancelled")
    override = _get_override(master_id, original_start)

    if scope == "this":
        return _update_this(master, original_start, override, data)
    if scope == "following" and original_start != parse_instant(master["start_at"]):
        return _update_following(master, original_start, override, data)
    return _update_all(master, original_start, override, data)


def _update_this(master, original_start, override, data):
    updates = v.pick(data, EVENT_FIELDS)  # rrule ignored for "this"
    cur_start, cur_end = _current_times(master, original_start, override)
    _edited_times(cur_start, cur_end, updates)

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
    shift, duration, times = _instance_edit(master, original_start, override, data)
    old_tz = master["timezone"]
    tz = data.get("timezone") or old_tz
    old_start = parse_instant(master["start_at"])
    series_start = rr.shift_wall(old_start, shift, old_tz)
    series_end = rr.shift_wall(series_start, duration, old_tz)

    body, explicit = _requested_rule(master, data)
    if body and not explicit:
        body = _moved_rule(body, (old_start, series_start), old_tz, tz)

    details = _changed_details(master, data)
    updates = {**details, "timezone": tz}
    if body:
        updates.update(_series_fields(body, series_start, series_end, tz))
        updates["exdates"], ops = _carry_exceptions(
            master,
            master["id"],
            updates,
            {
                "anchor": (old_start, series_start),
                "explicit": explicit,
                "exdates": _exdates(master),
                "overrides": _overrides(master["id"]),
                "details": details,
                "clicked": _clicked(override, data, times),
            },
        )
    else:
        # rrule cleared: the series collapses into a plain event.
        updates.update(
            rrule=None, recurrence_end_at=None, exdates=[], start_at=_iso(series_start), end_at=_iso(series_end)
        )
        ops = [_delete_overrides_op(master["id"])]

    return _apply([*ops, _update_op(master["id"], updates)], master["id"])


def _moved_rule(body: str, anchor, old_tz: str, tz: str) -> str:
    """The series' own rule, re-aimed for a move of one slot from anchor[0] to
    anchor[1]: weekdays / month days follow it, and UNTIL moves with it."""
    body = rr.shift_rule_days(body, anchor[0], anchor[1], old_tz, tz)
    return rr.shift_until(body, rr.wall_delta(anchor[0], anchor[1], old_tz, tz), old_tz, tz)


def _update_following(master, split_at, override, data):
    """Split the series at `split_at`: the old master ends before it and a new,
    independent series (taking the later exceptions along) starts there."""
    shift, duration, times = _instance_edit(master, split_at, override, data)
    old_tz = master["timezone"]
    tz = data.get("timezone") or old_tz
    old_start = parse_instant(master["start_at"])
    new_start = rr.shift_wall(split_at, shift, old_tz)
    new_end = rr.shift_wall(new_start, duration, old_tz)

    truncated, remaining = rr.truncate(master["rrule"], old_start, old_tz, split_at)

    body, explicit = _requested_rule(master, data)
    if body and not explicit:
        # Continue the old rule (COUNT -> remaining), re-aimed if moved.
        body = _moved_rule(rr.continuation_rule(body, remaining), (split_at, new_start), old_tz, tz)

    details = _changed_details(master, data)
    exdates_before, exdates_after = rr.partition_instants(_exdates(master), split_at)

    new_row = {f: master[f] for f in DETAIL_FIELDS}
    new_row.update(details, id=str(uuid.uuid4()), timezone=tz)
    if body:
        new_row.update(_series_fields(body, new_start, new_end, tz))
        new_row["exdates"], moved = _carry_exceptions(
            master,
            new_row["id"],
            new_row,
            {
                "anchor": (split_at, new_start),
                "explicit": explicit,
                "exdates": exdates_after,
                "overrides": _overrides(master["id"], split_at),
                "details": details,
                "clicked": _clicked(override, data, times),
                "skip_before": split_at,
            },
        )
    else:
        new_row.update(start_at=_iso(new_start), end_at=_iso(new_end))
        moved = [_delete_overrides_op(master["id"], split_at)]
    # Insert first so the carried overrides can be re-parented onto it, and
    # re-parent before the old master may be deleted (which cascades).
    ops = [{"op": "insert", "row": new_row}, *moved]

    if truncated is None or not rr.has_visible_occurrence(truncated, old_start, old_tz, exdates_before):
        # Everything before the split was cancelled: nothing of the old series is left.
        ops.append({"op": "delete", "id": master["id"]})
    else:
        old_end = rr.recurrence_end(truncated, old_start, parse_instant(master["end_at"]), old_tz)
        ops.append(
            _update_op(
                master["id"],
                {
                    "rrule": truncated,
                    "recurrence_end_at": _iso(old_end),
                    "exdates": [_iso(x) for x in exdates_before],
                },
            )
        )

    return _apply(ops, new_row["id"])


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
        return _cancel_occurrence(master, original_start)

    # following
    rule, _ = rr.truncate(master["rrule"], old_start, tz, original_start)
    exdates, _ = rr.partition_instants(_exdates(master), original_start)
    updates = {
        "rrule": rule,
        "recurrence_end_at": _iso(rr.recurrence_end(rule, old_start, parse_instant(master["end_at"]), tz)),
        "exdates": [_iso(x) for x in exdates],
    }
    return _save_or_drop_master(master, rule, exdates, updates, _delete_overrides_op(master_id, original_start))


def _cancel_occurrence(master: dict, original_start: datetime) -> dict:
    """Exdate one occurrence (dropping its override, if any)."""
    exdates = _exdates(master)
    if original_start not in exdates:
        exdates.append(original_start)
    updates = {"exdates": [_iso(x) for x in sorted(exdates)]}
    drop = _delete_overrides_op(master["id"], at=original_start)
    return _save_or_drop_master(master, master["rrule"], exdates, updates, drop)


def _save_or_drop_master(master: dict, rule: str, exdates, updates: dict, drop_overrides: dict) -> dict:
    """Drop overrides and apply updates to the master in one transaction, or
    delete the master when every remaining occurrence is cancelled (returning
    it as it was). Overridden occurrences aren't exdates, so a series with
    overrides always survives."""
    if not rr.has_visible_occurrence(rule, parse_instant(master["start_at"]), master["timezone"], exdates):
        return _delete_master(master["id"])
    return _apply([drop_overrides, _update_op(master["id"], updates)], master["id"])
