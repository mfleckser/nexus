import threading
import uuid
from datetime import UTC, datetime, time, timedelta
from functools import wraps

from supabase import PostgrestAPIError

from app import validation as v
from app.errors import Conflict, NotFound, ValidationError, first_row
from app.extensions.cache import EVENTS, TASKS, family_key, get_or_load, invalidate
from app.extensions.supabase import supabase
from app.services import recurrence as rr
from app.validation import parse_instant

EVENT_FIELDS = ["title", "description", "start_at", "end_at", "all_day", "category", "timezone"]
# Non-time fields a master shares with its overrides / split-off series.
DETAIL_FIELDS = ["title", "description", "category", "all_day"]
# Copied from the master onto rows an edit inserts (overrides, split-off
# series), never taken from a request body.
SERIES_FIELDS = ["created_via"]
SCOPES = ("this", "following", "all")


def _iso(dt):
    return dt.isoformat() if dt else None


def _now() -> datetime:
    return datetime.now(UTC)


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


def get_events(start: str, end: str):
    """Events overlapping the half-open window [start, end): plain rows
    (incl. overrides) plus expanded occurrences of recurring masters.
    Overlap: start_at < end AND end_at > start. Cached per window."""
    return get_or_load(family_key(EVENTS, start, end), lambda: _load_events(start, end), EVENTS)


def _load_events(start: str, end: str):
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


# Fields whose change can break an all-day row's midnight alignment.
ALL_DAY_INPUTS = ("start_at", "end_at", "timezone", "all_day")


def _check_all_day(all_day, start: datetime, end: datetime, tz: str):
    """An all-day event spans whole local days of its timezone: it starts at
    midnight of its first day and ends (exclusive) at midnight after its last."""
    if not all_day:
        return
    zone = rr.get_zone(tz)
    if not (start.astimezone(zone).time() == time(0) == end.astimezone(zone).time()):
        raise ValidationError("an all-day event must start and end at midnight in its timezone")


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
    """Serialize a mutation and clear the cached event windows after it, even
    after a failed one. A mutation that hit the stale-write guard (another
    process changed a row between its read and its write) is redone once from
    a fresh read before the Conflict reaches the client."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            with _write_lock:
                try:
                    return fn(*args, **kwargs)
                except Conflict:
                    return fn(*args, **kwargs)
        finally:
            # Deleting an event row (plain, master or override) nulls
            # tasks.event_id via its FK; many paths delete rows, so always clear.
            invalidate(EVENTS, TASKS)

    return wrapper


@invalidates_events
def create_event(data: dict):
    v.require(data, "title", "start_at", "end_at")
    _validate(data)
    start, end = parse_instant(data["start_at"]), parse_instant(data["end_at"])
    _check_order(start, end)
    _check_all_day(data.get("all_day"), start, end, data.get("timezone") or "UTC")

    # timezone is omitted (-> column default UTC) when the client didn't send one.
    row = v.pick(data, EVENT_FIELDS)
    row["created_via"] = v.created_via()

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
    if any(f in data for f in ("rrule", *ALL_DAY_INPUTS)):
        row = _get_event(event_id)
        if row["rrule"]:
            # A master's times are its first occurrence's: same as an "all" edit there.
            return _update_all(row, parse_instant(row["start_at"]), None, data)
        start = parse_instant(updates.get("start_at") or row["start_at"])
        end = parse_instant(updates.get("end_at") or row["end_at"])
        _check_order(start, end)
        _check_all_day(updates.get("all_day", row["all_day"]), start, end, updates.get("timezone") or row["timezone"])

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
# An op on a row the edit was computed from carries the updated_at it was read
# with (expect_updated_at): if another process changed the row since, the call
# fails whole (PT409) instead of overwriting that change.

STALE_WRITE = "PT409"


def _apply(ops: list, result_id: str = None):
    """Run the ops in one transaction; returns row `result_id` as it stands
    afterwards (None if not given or deleted)."""
    try:
        res = supabase.rpc("apply_event_writes", {"ops": ops, "result_id": result_id}).execute()
    except PostgrestAPIError as e:
        if e.code == "P0002":  # an updated row vanished mid-edit
            raise NotFound(e.message) from None
        if e.code == STALE_WRITE:
            raise Conflict("This event was changed elsewhere. Try again.") from None
        raise
    return res.data[0] if res.data else None


def _guard(op: dict, read: dict = None) -> dict:
    """`op` on a row as it was `read`: the RPC refuses it if the row changed since."""
    if read and read.get("updated_at"):
        op["expect_updated_at"] = read["updated_at"]
    return op


def _update_op(event_id: str, fields: dict, read: dict = None) -> dict:
    return _guard({"op": "update", "id": event_id, "set": fields}, read)


def _delete_op(row: dict) -> dict:
    """Delete a row the edit read (guarded, see _guard)."""
    return _guard({"op": "delete", "id": row["id"]}, row)


def _delete_overrides_op(master_id: str, from_start: datetime = None, at: datetime = None) -> dict:
    return {"op": "delete_overrides", "master": master_id, "from": _iso(from_start), "at": _iso(at)}


def _relink_tasks_op(from_id: str, to_id: str) -> dict:
    """Tasks time-blocked on event `from_id` move to `to_id` (both must exist)."""
    return {"op": "relink_tasks", "from": from_id, "to": to_id}


def _moved_day(slot: datetime, slots: dict, anchor, old_tz: str, tz: str):
    """The local date, in the new series' zone `tz`, an edit takes the old
    occurrence `slot` to: its new slot's (`slots`, see _slot_map), else that of
    the edited slot's wall-clock shift (`anchor`: its old and new start)."""
    moved = slots.get(slot) or rr.shift_wall(slot, rr.wall_delta(anchor[0], anchor[1], old_tz, tz), old_tz, tz)
    return moved.astimezone(rr.get_zone(tz)).date()


def _holds_day(series: dict, day) -> bool:
    """Whether a series (or plain event), given by its new columns (rrule,
    start_at, end_at, timezone, exdates), has an occurrence starting on the
    local date `day` of its timezone (see _moved_day)."""
    tz = series["timezone"]
    zone = rr.get_zone(tz)
    lo = datetime.combine(day, time(0), zone)
    hi = datetime.combine(day + timedelta(days=1), time(0), zone)
    start, end = parse_instant(series["start_at"]), parse_instant(series["end_at"])
    if not series.get("rrule"):
        return lo <= start < hi
    excluded = [parse_instant(x) for x in series.get("exdates") or []]
    return any(occ >= lo for occ, _ in rr.expand(series["rrule"], start, end, tz, lo, hi, excluded))


def _drop_overrides(overrides: list, day_of, target_id: str, target: dict, sweep: dict) -> list:
    """Ops dropping the override rows an edit read, then `sweep` (the
    delete_overrides op for their range, which also takes any added since):
    tasks time-blocked on one move first to the series `target_id` when its new
    columns `target` still have an occurrence on the day `day_of(slot)` the
    edit takes that override's slot to; the others are unlinked by the delete
    (FK), as for a cancelled occurrence."""
    relinks = [
        _relink_tasks_op(ov["id"], target_id)
        for ov in overrides
        if _holds_day(target, day_of(parse_instant(ov["original_start_at"])))
    ]
    return [*relinks, *(_delete_op(ov) for ov in overrides), sweep]


def _carry_exceptions(
    old: dict,
    new_id: str,
    new: dict,
    *,
    anchor,
    explicit: bool,
    exdates: list,
    overrides: list,
    details: dict,
    clicked,
):
    """Move a series' exceptions along when the series itself moves, so cancelled
    occurrences stay cancelled and edited ones stay edited.

    old          the master as it was
    new_id       the series receiving the exceptions (the master, or a split-off series)
    new          its new columns (rrule/start_at/end_at/timezone)
    anchor       (old instant, new instant) of the edited slot
    explicit     whether the edit set a new rule (else the old one is re-aimed)
    exdates      old exdates to carry; overrides: old override rows to carry
    details      changed detail fields, set on every carried override
    clicked      (override id, fields) for the override edited, or None

    Returns (exdates for the new series, ops for the overrides)."""
    old_tz, tz = old["timezone"], new["timezone"]
    slots = _slot_map(
        old,
        new,
        anchor,
        explicit,
        [*exdates, *(parse_instant(o["original_start_at"]) for o in overrides)],
    )
    old_duration = _wall_duration(old)
    new_duration = rr.wall_delta(parse_instant(new["start_at"]), parse_instant(new["end_at"]), tz)

    new_exdates = sorted({slots[x] for x in exdates if x in slots})
    target = {**new, "exdates": [_iso(x) for x in new_exdates]}

    ops, taken = [], set()
    for ov in overrides:
        slot = parse_instant(ov["original_start_at"])
        new_slot = slots.get(slot)
        if not new_slot or new_slot in taken:
            # Its slot is gone or another override's: its tasks stay on the
            # series when that still occurs on the day (always so for a taken slot).
            if new_slot or _holds_day(target, _moved_day(slot, slots, anchor, old_tz, tz)):
                ops.append(_relink_tasks_op(ov["id"], new_id))
            ops.append(_delete_op(ov))
            continue
        taken.add(new_slot)
        # A moved override keeps its offset from its slot; one with the series'
        # length takes the new length, a custom length stays.
        ov_start, ov_end = parse_instant(ov["start_at"]), parse_instant(ov["end_at"])
        ov_tz = tz if ov["timezone"] == old_tz else ov["timezone"]
        if ov["all_day"]:
            # Stays on whole days of its own zone: moves by the days its slot
            # moved (a timed series' shift within a day leaves it in place).
            moved_start = rr.shift_wall(ov_start, rr.day_delta(slot, new_slot, old_tz, tz), ov["timezone"], ov_tz)
            length = rr.wall_delta(ov_start, ov_end, ov["timezone"])
            same_length = old["all_day"] and length == old_duration
            end_tz = ov_tz
        else:
            moved_start = rr.shift_wall(ov_start, rr.wall_delta(slot, new_slot, old_tz, tz), old_tz, tz)
            length = rr.wall_delta(ov_start, ov_end, old_tz)
            same_length, end_tz = length == old_duration, tz
        moved_end = rr.shift_wall(moved_start, new_duration if same_length else length, end_tz)

        fields = {
            "recurring_event_id": new_id,
            "original_start_at": _iso(new_slot),
            "start_at": _iso(moved_start),
            "end_at": _iso(moved_end),
            "timezone": ov_tz,
            **details,
        }
        if clicked and ov["id"] == clicked[0]:
            fields.update(clicked[1])
        changed = {k: val for k, val in fields.items() if not _same(k, val, ov[k])}
        if changed:
            # e.g. the clicked occurrence made all-day without moving it to midnights.
            row = {**ov, **changed}
            _check_all_day(
                row["all_day"], parse_instant(row["start_at"]), parse_instant(row["end_at"]), row["timezone"]
            )
            ops.append(_update_op(ov["id"], changed, ov))
    return [_iso(x) for x in new_exdates], ops


def _slot_map(old: dict, new: dict, anchor, explicit: bool, instants) -> dict:
    """{old occurrence start: its start in the new series} for `instants`;
    those the new series doesn't have are left out.

    Each instant moves by the edited slot's wall-clock shift if that lands on
    an occurrence of the new rule. When the rule was only re-aimed, a miss
    (2nd Tuesday -> 2nd Wednesday in a month starting on a Wednesday) takes the
    new occurrence at the same position in the same month / year, if no shift
    claimed it; else it is dropped (e.g. Apr 30 when the 30th becomes the 31st).
    A re-aimed monthly rule with several ordinals pairs by token instead
    (rr.pair_by_token)."""
    old_tz, tz = old["timezone"], new["timezone"]
    new_start = parse_instant(new["start_at"])
    delta = rr.wall_delta(anchor[0], anchor[1], old_tz, tz)

    instants = {rr.to_utc(x) for x in instants}
    old_rule = (old["rrule"], parse_instant(old["start_at"]), old_tz)
    if not explicit and rr.ordinal_weekdays(old["rrule"]) and rr.ordinal_weekdays(new["rrule"]):
        # Several ordinals (2TU,4TU -> 2WE,4WE) are kept as written: the shift
        # can land on another token (2nd Tue + 1 day = 3rd Wed), so pair by token.
        return rr.pair_by_token(old_rule, (new["rrule"], new_start, tz), instants, anchor[0])
    moved = {x: rr.shift_wall(x, delta, old_tz, tz) for x in instants}
    occurring = rr.occurrences_between(new["rrule"], new_start, tz, moved.values())
    result = {x: m for x, m in moved.items() if m in occurring}

    misses = instants - result.keys()
    if misses and not explicit:
        pairs = rr.pair_in_period(old_rule, (new["rrule"], new_start, tz), {x: moved[x] for x in misses}, anchor[0])
        if not pairs:
            return result
        # A pair may not take a slot some other occurrence (exception or not)
        # shifts onto: that one is the slot's rightful owner.
        margin = timedelta(days=400)  # > one period (a year)
        neighbours = rr.occurrences_between(*old_rule, [min(misses) - margin, max(misses) + margin])
        shifted = {rr.shift_wall(x, delta, old_tz, tz) for x in neighbours}
        claimed = shifted & rr.occurrences_between(new["rrule"], new_start, tz, shifted)
        for x in sorted(misses):
            if x in pairs and pairs[x] not in claimed:
                result[x] = pairs[x]
                claimed.add(pairs[x])
    return result


def _same(col: str, a, b) -> bool:
    if col in ("start_at", "end_at", "original_start_at") and a and b:
        return parse_instant(a) == parse_instant(b)
    return a == b


def _exdates(master: dict) -> list:
    return [parse_instant(x) for x in master["exdates"] or []]


def _clicked(override, data: dict, times):
    """The clicked (overridden) occurrence lands exactly at the edited times and
    gets every detail field sent, even ones equal to the series value that
    _changed_details leaves out. That includes all_day: an override switching
    kind (all-day vs timed) onto the series' times leaves the series as is."""
    if not override:
        return None
    return override["id"], {**v.pick(data, DETAIL_FIELDS), "start_at": _iso(times[0]), "end_at": _iso(times[1])}


def _changed_details(master: dict, data: dict) -> dict:
    def differs(f):
        # all_day NULL (older rows) and false are the same.
        return bool(data[f]) != bool(master[f]) if f == "all_day" else data[f] != master[f]

    return {f: data[f] for f in DETAIL_FIELDS if f in data and differs(f)}


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
    moved = data.get("start_at") or data.get("end_at")
    if moved and override and _changes_kind(master, override, data):
        # An instance that is, or becomes, the other kind (all-day vs timed)
        # shares nothing with the series' shape: measure from where the series
        # puts this occurrence, so the series lands on the new times.
        cur_start, cur_end = _current_times(master, original_start, None)

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


def _changes_kind(master: dict, override: dict, data: dict) -> bool:
    """Whether the override is, or the edit makes it, all-day where the series
    is timed or vice versa (all_day NULL counts as timed)."""
    series = bool(master["all_day"])
    return bool(override["all_day"]) != series or bool(data.get("all_day", override["all_day"])) != series


def _wall_duration(master: dict) -> timedelta:
    return rr.wall_delta(parse_instant(master["start_at"]), parse_instant(master["end_at"]), master["timezone"])


def _requested_rule(master: dict, data: dict):
    """(rule, explicit): the body's rrule when it differs from the master's
    (None = does not repeat), else the master's own rule with explicit=False."""
    if "rrule" not in data:
        return master["rrule"], False
    requested = data["rrule"] or None
    if requested and _rule_key(requested, master) == _rule_key(master["rrule"], master):
        return master["rrule"], False
    return requested, True


def _rule_key(body: str, master: dict) -> dict:
    """A rule's parts in canonical form, so an equivalent spelling of the
    series' own rule isn't taken for a new one."""
    try:
        parts = rr.parse_rule(rr.normalize_rrule(body, parse_instant(master["start_at"]), master["timezone"]))
    except ValidationError:
        # e.g. no occurrence from the old start: can't be the series' own rule;
        # the new series' start validates it properly.
        return rr.parse_rule(body)
    for key, default in (("INTERVAL", "1"), ("WKST", "MO")):
        if parts.get(key) == default:
            del parts[key]
    # Spell out what the start implies (FREQ=WEEKLY -> BYDAY=<its weekday>, ...).
    local = parse_instant(master["start_at"]).astimezone(rr.get_zone(master["timezone"]))
    if parts["FREQ"] == "WEEKLY":
        parts.setdefault("BYDAY", rr.WEEKDAYS[local.weekday()])
    elif parts["FREQ"] in ("MONTHLY", "YEARLY") and "BYDAY" not in parts:
        parts.setdefault("BYMONTHDAY", str(local.day))
        if parts["FREQ"] == "YEARLY":
            parts.setdefault("BYMONTH", str(local.month))
    if "BYDAY" in parts:
        parts["BYDAY"] = parts["BYDAY"].replace("+", "")
    for key in ("BYDAY", "BYMONTHDAY", "BYMONTH"):
        if key in parts:
            parts[key] = ",".join(sorted(parts[key].split(",")))
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
    new_start, new_end = _edited_times(cur_start, cur_end, updates)
    if any(f in data for f in ALL_DAY_INPUTS):
        cur = override or master
        _check_all_day(
            updates.get("all_day", cur["all_day"]), new_start, new_end, updates.get("timezone") or cur["timezone"]
        )

    if not updates:
        row = override or _instance(master, cur_start, cur_end)
    elif override:
        row = supabase.table("events").update(updates).eq("id", override["id"]).execute().data[0]
    else:
        new_row = {f: master[f] for f in DETAIL_FIELDS + SERIES_FIELDS + ["timezone"]}
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
    _check_all_day(data.get("all_day", master["all_day"]), series_start, series_end, tz)

    body, explicit = _requested_rule(master, data)
    if body and not explicit:
        body = _moved_rule(body, (old_start, series_start), old_tz, tz)

    details = _changed_details(master, data)
    updates = {**details, "timezone": tz}
    if body and "all_day" in details:
        updates.update(_series_fields(body, series_start, series_end, tz))
        updates["exdates"], ops = _switch_kind(
            master,
            master["id"],
            updates,
            anchor=(old_start, series_start),
            explicit=explicit,
            exdates=_exdates(master),
            overrides=_overrides(master["id"]),
            drop_overrides=_delete_overrides_op(master["id"]),
        )
    elif body:
        updates.update(_series_fields(body, series_start, series_end, tz))
        updates["exdates"], ops = _carry_exceptions(
            master,
            master["id"],
            updates,
            anchor=(old_start, series_start),
            explicit=explicit,
            exdates=_exdates(master),
            overrides=_overrides(master["id"]),
            details=details,
            clicked=_clicked(override, data, times),
        )
    else:
        # rrule cleared: the series collapses into a plain event.
        updates.update(
            rrule=None, recurrence_end_at=None, exdates=[], start_at=_iso(series_start), end_at=_iso(series_end)
        )
        ops = _drop_overrides(
            _overrides(master["id"]),
            lambda slot: _moved_day(slot, {}, (old_start, series_start), old_tz, tz),
            master["id"],
            updates,
            _delete_overrides_op(master["id"]),
        )

    return _apply([*ops, _update_op(master["id"], updates, master)], master["id"])


def _switch_kind(old: dict, new_id: str, new: dict, *, anchor, explicit: bool, exdates, overrides, drop_overrides):
    """A series switching kind (all-day vs timed): its overrides' times fit the
    old kind only, so they are dropped rather than carried (their tasks move to
    the series `new_id` where it still occurs on their day). Cancelled days stay
    cancelled: exdates move as for any series move (see _slot_map; the slot's
    wall-clock shift takes 9 AM to midnight of the same or moved-to day and
    back), dropped where the new series has no occurrence.
    Returns (exdates for the new series, ops)."""
    kept = [_iso(x) for x in sorted(set(_slot_map(old, new, anchor, explicit, exdates).values()))]
    # Mapped on their own, so a dropped override never takes an exdate's slot.
    slots = _slot_map(old, new, anchor, explicit, [parse_instant(o["original_start_at"]) for o in overrides])

    def day_of(slot):
        return _moved_day(slot, slots, anchor, old["timezone"], new["timezone"])

    return kept, _drop_overrides(overrides, day_of, new_id, {**new, "exdates": kept}, drop_overrides)


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
    _check_all_day(data.get("all_day", master["all_day"]), new_start, new_end, tz)

    truncated, remaining = rr.truncate(master["rrule"], old_start, old_tz, split_at)

    body, explicit = _requested_rule(master, data)
    if body and not explicit:
        # Continue the old rule (COUNT -> remaining), re-aimed if moved.
        body = _moved_rule(rr.continuation_rule(body, remaining), (split_at, new_start), old_tz, tz)

    details = _changed_details(master, data)
    exdates_before, exdates_after = rr.partition_instants(_exdates(master), split_at)

    new_row = {f: master[f] for f in DETAIL_FIELDS + SERIES_FIELDS}
    new_row.update(details, id=str(uuid.uuid4()), timezone=tz)
    if body and "all_day" in details:
        new_row.update(_series_fields(body, new_start, new_end, tz))
        new_row["exdates"], moved = _switch_kind(
            master,
            new_row["id"],
            new_row,
            anchor=(split_at, new_start),
            explicit=explicit,
            exdates=exdates_after,
            overrides=_overrides(master["id"], split_at),
            drop_overrides=_delete_overrides_op(master["id"], split_at),
        )
    elif body:
        new_row.update(_series_fields(body, new_start, new_end, tz))
        new_row["exdates"], moved = _carry_exceptions(
            master,
            new_row["id"],
            new_row,
            anchor=(split_at, new_start),
            explicit=explicit,
            exdates=exdates_after,
            overrides=_overrides(master["id"], split_at),
            details=details,
            clicked=_clicked(override, data, times),
        )
    else:
        new_row.update(start_at=_iso(new_start), end_at=_iso(new_end))
        moved = _drop_overrides(
            _overrides(master["id"], split_at),
            lambda slot: _moved_day(slot, {}, (split_at, new_start), old_tz, tz),
            new_row["id"],
            new_row,
            _delete_overrides_op(master["id"], split_at),
        )
    # Insert first so the carried overrides can be re-parented onto it, and
    # re-parent before the old master may be deleted (which cascades).
    ops = [{"op": "insert", "row": new_row}, *moved]

    if truncated is None or not rr.has_visible_occurrence(truncated, old_start, old_tz, exdates_before):
        # Everything before the split was cancelled: nothing of the old series is
        # left. Its time-blocked tasks follow the series to the new master, moved
        # before the delete, whose FK would otherwise unlink them.
        ops += [_relink_tasks_op(master["id"], new_row["id"]), _delete_op(master)]
    else:
        if not _occurs_ahead(master, truncated, exdates_before, split_at):
            # A task time-blocked on the series follows its next occurrence from
            # now: in the new half when the old one has none left (or, with none
            # left anywhere, the latest one, also in the new half).
            ops.append(_relink_tasks_op(master["id"], new_row["id"]))
        old_end = rr.recurrence_end(truncated, old_start, parse_instant(master["end_at"]), old_tz)
        ops.append(
            _update_op(
                master["id"],
                {
                    "rrule": truncated,
                    "recurrence_end_at": _iso(old_end),
                    "exdates": [_iso(x) for x in exdates_before],
                },
                master,
            )
        )

    return _apply(ops, new_row["id"])


def _occurs_ahead(master: dict, rule: str, exdates: list, split_at: datetime) -> bool:
    """Whether the part of `master` before `split_at` (its `rule` and `exdates`)
    has an occurrence starting at or after now: an overridden one counts at
    its override's own start."""
    now = _now()
    overrides = [o for o in _overrides(master["id"]) if parse_instant(o["original_start_at"]) < split_at]
    if any(parse_instant(o["start_at"]) >= now for o in overrides):
        return True
    excluded = [*exdates, *(parse_instant(o["original_start_at"]) for o in overrides)]
    return rr.has_visible_occurrence(rule, parse_instant(master["start_at"]), master["timezone"], excluded, after=now)


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
        _apply([_delete_op(master)])
        return master
    return _apply([drop_overrides, _update_op(master["id"], updates, master)], master["id"])
