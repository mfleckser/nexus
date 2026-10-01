"""Pure recurrence helpers (no DB access).

A series is described by an RFC 5545 RRULE *body* (no "RRULE:" prefix, no
DTSTART), the master's first-occurrence start/end, and an IANA timezone name.
Expansion happens in that timezone so wall-clock times stay put across DST.
All datetimes accepted and returned here are timezone-aware; returned ones are UTC.
"""

import calendar
import re
from datetime import datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import rrulestr

UTC = dt_timezone.utc
UNTIL_FORMAT = "%Y%m%dT%H%M%SZ"

# Keep rules to the subset the UI emits, and bound how much work one can cause.
FREQS = ("DAILY", "WEEKLY", "MONTHLY", "YEARLY")
ALLOWED_KEYS = ("FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST")
MAX_COUNT = 1000
HORIZON = timedelta(days=round(365.25 * 50))  # UNTIL / first-occurrence search limit
MAX_SCAN = 20000  # > daily for 50 years
WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
BYDAY_TOKEN = re.compile(r"^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$")


def to_utc(dt: datetime) -> datetime:
    return dt.astimezone(UTC)


def get_zone(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"unknown timezone: {tz_name!r}")


def format_until(dt: datetime) -> str:
    return to_utc(dt).strftime(UNTIL_FORMAT)


# ---- rule body <-> parts -------------------------------------------------

def parse_rule(body: str) -> dict:
    """Split an RRULE body into an ordered {KEY: value} dict. Light syntactic
    checks only; semantic validation happens in normalize_rrule."""
    if not isinstance(body, str) or not body.strip():
        raise ValueError("rrule must be a non-empty string")
    body = body.strip()
    if body.upper().startswith("RRULE:"):
        body = body[len("RRULE:"):]
    if "\n" in body or "\r" in body:
        raise ValueError("rrule must be a single RRULE body")

    parts = {}
    for item in body.split(";"):
        if not item:
            continue
        key, sep, value = item.partition("=")
        key = key.strip().upper()
        if not sep or not key or not value.strip():
            raise ValueError(f"malformed rrule part: {item!r}")
        if key in parts:
            raise ValueError(f"duplicate rrule part: {key}")
        parts[key] = value.strip().upper()
    return parts


def format_rule(parts: dict) -> str:
    return ";".join(f"{k}={v}" for k, v in parts.items())


def is_bounded(body: str) -> bool:
    parts = parse_rule(body)
    return "COUNT" in parts or "UNTIL" in parts


def without_bounds(parts: dict) -> dict:
    return {k: v for k, v in parts.items() if k not in ("COUNT", "UNTIL")}


# ---- building / validating ----------------------------------------------

def build_rule(body: str, start: datetime, tz_name: str):
    """dateutil rrule whose DTSTART is `start` expressed in `tz_name`."""
    dtstart = start.astimezone(get_zone(tz_name))
    return rrulestr(body, dtstart=dtstart)


def normalize_rrule(body: str, start: datetime, tz_name: str) -> str:
    """Validate an RRULE body against a series start and return its canonical
    form (upper-case, UNTIL in UTC Z form). Raises ValueError on bad input,
    including rules that produce no occurrence at or after `start`."""
    parts = parse_rule(body)

    unknown = [k for k in parts if k not in ALLOWED_KEYS]
    if unknown:
        raise ValueError(f"unsupported rrule part(s): {', '.join(unknown)}")
    if parts.get("FREQ") not in FREQS:
        raise ValueError(f"rrule FREQ must be one of {', '.join(FREQS)}")
    if "COUNT" in parts and "UNTIL" in parts:
        raise ValueError("rrule cannot have both COUNT and UNTIL")
    for key in ("COUNT", "INTERVAL"):
        if key in parts and (not parts[key].isdigit() or int(parts[key]) < 1):
            raise ValueError(f"rrule {key} must be a positive integer")
    if int(parts.get("COUNT", 1)) > MAX_COUNT:
        raise ValueError(f"rrule COUNT must be at most {MAX_COUNT}")
    _check_month_days(parts)

    try:
        rule = build_rule(format_rule(parts), start, tz_name)
    except ValueError:
        raise
    except Exception as e:  # dateutil raises assorted types on bad input
        raise ValueError(f"invalid rrule: {e}")

    if "UNTIL" in parts:
        if rule._until > start + HORIZON:
            raise ValueError("rrule UNTIL must be within 50 years of the start")
        parts["UNTIL"] = format_until(rule._until)

    body = format_rule(parts)
    if first_occurrence(body, start, tz_name) is None:
        raise ValueError("rrule produces no occurrences")
    return body


def _check_month_days(parts: dict):
    """Reject BYMONTH x BYMONTHDAY combos that name no real date (e.g. Feb 30);
    dateutil would otherwise scan to year 9999 looking for one."""
    if "BYMONTH" not in parts or "BYMONTHDAY" not in parts:
        return
    try:
        months = [int(m) for m in parts["BYMONTH"].split(",")]
        days = [int(d) for d in parts["BYMONTHDAY"].split(",")]
    except ValueError:
        raise ValueError("rrule BYMONTH / BYMONTHDAY must be integers")
    longest = {m: calendar.monthrange(2024, m)[1] for m in range(1, 13)}  # leap year
    if not any(d < 0 or d <= longest.get(m, 0) for m in months for d in days):
        raise ValueError("rrule BYMONTH / BYMONTHDAY name no real date")


# ---- occurrences ---------------------------------------------------------

def first_occurrence(body: str, start: datetime, tz_name: str):
    """First occurrence at or after `start` (DTSTART only counts if the rule
    matches it), or None if the rule has none within HORIZON."""
    for occ in build_rule(body, start, tz_name):
        return to_utc(occ) if occ <= start + HORIZON else None
    return None


def has_visible_occurrence(body: str, start: datetime, tz_name: str, excluded) -> bool:
    """Whether any occurrence survives `excluded` (exdates)."""
    excluded = {to_utc(x) for x in excluded}
    for i, occ in enumerate(build_rule(body, start, tz_name)):
        if to_utc(occ) not in excluded:
            return True
        if i >= MAX_SCAN:
            return True  # far too many to all be exdated; assume visible
    return False


def is_occurrence(body: str, start: datetime, tz_name: str, instant: datetime) -> bool:
    rule = build_rule(body, start, tz_name)
    return any(to_utc(o) == to_utc(instant) for o in rule.between(instant, instant, inc=True))


def expand(body, start, end, tz_name, window_start, window_end, excluded=()):
    """Occurrences (start, end) of the series overlapping [window_start, window_end),
    skipping original starts in `excluded` (exdates / overridden occurrences).
    Overlap: occ_start < window_end and occ_start + duration > window_start."""
    duration = end - start
    excluded = {to_utc(x) for x in excluded}
    rule = build_rule(body, start, tz_name)

    result = []
    for occ in rule.between(window_start - duration, window_end, inc=True):
        occ = to_utc(occ)
        if not (occ < window_end and occ + duration > window_start):
            continue
        if occ in excluded:
            continue
        result.append((occ, occ + duration))
    return result


def recurrence_end(body: str, start: datetime, end: datetime, tz_name: str):
    """End of the last occurrence for a bounded rule (COUNT/UNTIL), else None."""
    if not is_bounded(body):
        return None
    last = None
    for i, last in enumerate(build_rule(body, start, tz_name)):
        if i >= MAX_SCAN:
            raise ValueError("rrule has too many occurrences")
    if last is None:
        return None
    return to_utc(last) + (end - start)


# ---- splitting a series --------------------------------------------------

def truncate(body: str, start: datetime, tz_name: str, split_at: datetime):
    """Cut a series so it ends before `split_at`.

    Returns (truncated_body, remaining_count):
      truncated_body   old rule with UNTIL = split_at - 1s (UTC); None when no
                       occurrence precedes split_at (the whole series is cut).
      remaining_count  if the old rule used COUNT, how many of its occurrences
                       are at or after split_at (the new series' COUNT); else None.
    """
    parts = parse_rule(body)
    before = 0
    for occ in build_rule(body, start, tz_name):
        if occ >= split_at:
            break
        before += 1

    remaining = None
    if "COUNT" in parts:
        remaining = max(int(parts["COUNT"]) - before, 0)

    if before == 0:
        return None, remaining

    truncated = without_bounds(parts)
    truncated["UNTIL"] = format_until(split_at - timedelta(seconds=1))
    return format_rule(truncated), remaining


def continuation_rule(body: str, remaining_count):
    """Rule for the new series created by a split when the caller didn't
    supply one: the old rule, with COUNT replaced by the remaining count."""
    parts = parse_rule(body)
    if remaining_count is not None and "COUNT" in parts:
        parts["COUNT"] = str(remaining_count)
    return format_rule(parts)


def partition_instants(instants, split_at: datetime):
    """Split instants into (before split_at, at-or-after split_at), UTC."""
    before, after = [], []
    for x in instants:
        x = to_utc(x)
        (before if x < split_at else after).append(x)
    return before, after


# ---- moving a series -----------------------------------------------------

def _local_naive(dt: datetime, tz_name: str) -> datetime:
    return dt.astimezone(get_zone(tz_name)).replace(tzinfo=None)


def wall_delta(before: datetime, after: datetime, tz_name: str) -> timedelta:
    """How far an instance moved in local wall-clock terms."""
    return _local_naive(after, tz_name) - _local_naive(before, tz_name)


def shift_wall(dt: datetime, delta: timedelta, tz_name: str) -> datetime:
    """Move `dt` by a wall-clock delta in `tz_name` (DST-safe); returns UTC."""
    return to_utc((_local_naive(dt, tz_name) + delta).replace(tzinfo=get_zone(tz_name)))


def shift_rule_days(body: str, old_anchor: datetime, new_anchor: datetime, tz_name: str) -> str:
    """Re-aim a rule when its series moves to another local day (GCal-style):
    BYDAY weekdays shift by the day delta, BYMONTHDAY / BYMONTH become the new
    local day / month. A single ordinal BYDAY (e.g. 2TU, -1FR) gets its ordinal
    recomputed from the new date; with several, ordinals are kept as-is."""
    old_date = _local_naive(old_anchor, tz_name).date()
    new_date = _local_naive(new_anchor, tz_name).date()
    days = (new_date - old_date).days
    if days == 0:
        return body

    parts = parse_rule(body)
    if "BYDAY" in parts:
        tokens = [BYDAY_TOKEN.match(t) for t in parts["BYDAY"].split(",")]
        if not all(tokens):
            raise ValueError(f"invalid BYDAY: {parts['BYDAY']}")
        shifted = []
        for m in tokens:
            ordinal, day = m.group(1), m.group(2)
            day = WEEKDAYS[(WEEKDAYS.index(day) + days) % 7]
            if ordinal and len(tokens) == 1:
                ordinal = str(_nth_weekday_ordinal(new_date, negative=int(ordinal) < 0))
            shifted.append(f"{ordinal or ''}{day}")
        parts["BYDAY"] = ",".join(shifted)
    if "BYMONTHDAY" in parts:
        parts["BYMONTHDAY"] = str(new_date.day)
    if "BYMONTH" in parts:
        parts["BYMONTH"] = str(new_date.month)
    return format_rule(parts)


def _nth_weekday_ordinal(d, negative: bool) -> int:
    """Which occurrence of its weekday `d` is within its month (1..5, or -1..-5)."""
    if negative:
        days_in_month = calendar.monthrange(d.year, d.month)[1]
        return -((days_in_month - d.day) // 7 + 1)
    return (d.day - 1) // 7 + 1
