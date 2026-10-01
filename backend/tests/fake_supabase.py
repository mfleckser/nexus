"""Minimal in-memory stand-in for the supabase-py query builder, covering only
what event_service uses. Timestamps are stored the way PostgREST returns them
(UTC ISO with +00:00) and compared as instants."""

import re
import uuid
from datetime import datetime, timezone

TIMESTAMP_COLS = {"start_at", "end_at", "recurrence_end_at", "original_start_at"}
DEFAULTS = {
    "title": None, "description": None, "category": None, "all_day": None, "timezone": "UTC",
    "rrule": None, "recurrence_end_at": None, "exdates": [], "recurring_event_id": None,
    "original_start_at": None,
}


def _instant(value):
    dt = datetime.fromisoformat(value)
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def _store(col, value):
    if value is None:
        return None
    if col in TIMESTAMP_COLS:
        return _instant(value).isoformat()
    if col == "exdates":
        return [_instant(x).isoformat() for x in value]
    return value


def _cmp(col, value):
    return _instant(value) if col in TIMESTAMP_COLS else value


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db):
        self.db = db
        self.op = "select"
        self.payload = None
        self.filters = []
        self.negate = False

    def select(self, *_):
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def update(self, row):
        self.op, self.payload = "update", row
        return self

    def delete(self):
        self.op = "delete"
        return self

    @property
    def not_(self):
        self.negate = True
        return self

    def _filter(self, fn):
        negate, self.negate = self.negate, False
        self.filters.append((lambda r: not fn(r)) if negate else fn)
        return self

    def eq(self, c, v):
        return self._filter(lambda r: r[c] is not None and _cmp(c, r[c]) == _cmp(c, v))

    def lt(self, c, v):
        return self._filter(lambda r: r[c] is not None and _cmp(c, r[c]) < _cmp(c, v))

    def gt(self, c, v):
        return self._filter(lambda r: r[c] is not None and _cmp(c, r[c]) > _cmp(c, v))

    def gte(self, c, v):
        return self._filter(lambda r: r[c] is not None and _cmp(c, r[c]) >= _cmp(c, v))

    def is_(self, c, v):
        assert v == "null"
        return self._filter(lambda r: r[c] is None)

    def in_(self, c, values):
        return self._filter(lambda r: r[c] in values)

    def or_(self, expr):
        m = re.fullmatch(r'recurrence_end_at\.is\.null,recurrence_end_at\.gt\."(.+)"', expr)
        assert m, expr
        bound = _instant(m.group(1))
        return self._filter(lambda r: r["recurrence_end_at"] is None or _instant(r["recurrence_end_at"]) > bound)

    def order(self, *_):
        return self

    def execute(self):
        if self.db.fail_on == self.op:
            raise RuntimeError("simulated DB failure")
        rows = self.db.rows
        match = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "select":
            return _Result([dict(r) for r in match])
        if self.op == "insert":
            row = {"id": str(uuid.uuid4()), **DEFAULTS}
            row.update({k: _store(k, v) for k, v in self.payload.items()})
            rows.append(row)
            return _Result([dict(row)])
        if self.op == "update":
            if not self.payload:
                raise RuntimeError("empty update")  # PostgREST rejects these too
            for r in match:
                r.update({k: _store(k, v) for k, v in self.payload.items()})
            return _Result([dict(r) for r in match])
        # delete, with on-delete-cascade from masters to overrides
        ids = {r["id"] for r in match}
        ids |= {r["id"] for r in rows if r["recurring_event_id"] in ids}
        rows[:] = [r for r in rows if r["id"] not in ids]
        return _Result([dict(r) for r in match])


class FakeSupabase:
    def __init__(self):
        self.rows = []
        self.fail_on = None  # set to "update"/"insert"/... to simulate a failure

    def table(self, name):
        assert name == "events"
        return _Query(self)
