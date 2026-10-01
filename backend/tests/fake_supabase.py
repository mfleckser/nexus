"""Minimal in-memory stand-in for the supabase-py query builder, covering only
what the services use. Timestamps are stored the way PostgREST returns them
(UTC ISO with +00:00) and compared as instants. A few Postgres behaviors are
mimicked because the API maps them to status codes: NOT NULL (23502), CHECK
(23514), invalid uuid / timestamp text (22P02 / 22007), and FK on-delete
cascade / set null."""

import copy
import re
import uuid
from datetime import UTC, datetime, timedelta

from supabase import PostgrestAPIError

TIMESTAMP_COLS = {
    "start_at", "end_at", "recurrence_end_at", "original_start_at",
    "due_at", "completed_at", "created_at", "updated_at",
}  # fmt: skip

TABLES = {
    "events": {
        "defaults": {
            "title": None, "description": None, "category": None, "all_day": None, "timezone": "UTC",
            "rrule": None, "recurrence_end_at": None, "exdates": [], "recurring_event_id": None,
            "original_start_at": None,
        },
        "not_null": {"title", "start_at", "end_at", "timezone", "exdates"},
    },
    "tasks": {
        "defaults": {
            "title": None, "description": None, "status": "todo", "due_at": None, "completed_at": None,
            "project_id": None, "feature_id": None, "event_id": None,
        },
        "not_null": {"title"},
        "checks": {"status": {None, "todo", "active", "complete", "cancelled"}},
    },
    "projects": {
        "defaults": {
            "title": None, "description": None, "type": None, "status": "active", "notes": None,
            "notes_updated_at": None, "show_tasks_in_main_view": True,
        },
        "not_null": {"title", "description", "show_tasks_in_main_view"},
    },
    "features": {
        "defaults": {"project_id": None, "name": None, "notes": None, "notes_updated_at": None},
        "not_null": {"project_id", "name"},
    },
}  # fmt: skip

# (child table, child column, parent table, on delete)
FOREIGN_KEYS = [
    ("events", "recurring_event_id", "events", "cascade"),
    ("tasks", "event_id", "events", "set null"),
    ("tasks", "project_id", "projects", "set null"),
    ("tasks", "feature_id", "features", "set null"),
    ("features", "project_id", "projects", "cascade"),
]


def _pg_error(code, message):
    return PostgrestAPIError({"code": code, "message": message, "details": None, "hint": None})


def _instant(value):
    try:
        dt = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        raise _pg_error("22007", f'invalid input syntax for type timestamp with time zone: "{value}"') from None
    return (dt if dt.tzinfo else dt.replace(tzinfo=UTC)).astimezone(UTC)


def _check_uuid(col, value):
    if value is not None and (col == "id" or col.endswith("_id")):
        try:
            uuid.UUID(str(value))
        except ValueError:
            raise _pg_error("22P02", f'invalid input syntax for type uuid: "{value}"') from None


def _store(col, value):
    if value is None:
        return None
    _check_uuid(col, value)
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
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.op = "select"
        self.payload = None
        self.filters = []
        self.negate = False
        self.ordering = []
        self.row_limit = None

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
        _check_uuid(c, v)
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

    def order(self, column, desc=False):
        self.ordering.append((column, desc))
        return self

    def limit(self, n):
        self.row_limit = n
        return self

    def _check_values(self, row, cols):
        schema = TABLES[self.table]
        for c in cols:
            if c in schema["not_null"] and row.get(c) is None:
                raise _pg_error("23502", f'null value in column "{c}" of relation "{self.table}"')
            allowed = schema.get("checks", {}).get(c)
            if allowed is not None and row.get(c) not in allowed:
                raise _pg_error("23514", f'new row for relation "{self.table}" violates check constraint')

    def execute(self):
        if self.db.fail_on == self.op:
            raise RuntimeError("simulated DB failure")
        rows = self.db.tables[self.table]
        match = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "select":
            # Stable sorts applied last-key-first give multi-column ordering; nulls last.
            for col, desc in reversed(self.ordering):
                match.sort(key=lambda r, c=col: (r[c] is None, _cmp(c, r[c]) if r[c] is not None else 0), reverse=desc)
            return _Result([copy.deepcopy(r) for r in match[: self.row_limit]])
        if self.op == "insert":
            now = self.db.tick()
            row = {"id": str(uuid.uuid4()), "created_at": now, "updated_at": now}
            row.update(copy.deepcopy(TABLES[self.table]["defaults"]))
            row.update({k: _store(k, v) for k, v in self.payload.items()})
            self._check_values(row, row.keys())
            rows.append(row)
            return _Result([copy.deepcopy(row)])
        if self.op == "update":
            if not self.payload:
                raise RuntimeError("empty update")  # PostgREST rejects these too
            values = {k: _store(k, v) for k, v in self.payload.items()}
            self._check_values(values, values.keys())
            now = self.db.tick()
            for r in match:
                r.update(values, updated_at=now)
            return _Result([copy.deepcopy(r) for r in match])
        self.db.delete_rows(self.table, {r["id"] for r in match})
        return _Result([copy.deepcopy(r) for r in match])


class FakeSupabase:
    def __init__(self):
        self.tables = {name: [] for name in TABLES}
        self.rows = self.tables["events"]  # back-compat for the event tests
        self.fail_on = None  # set to "update"/"insert"/... to simulate a failure
        self.queries = []  # table names, in call order
        self._clock = datetime(2026, 1, 1, tzinfo=UTC)

    def tick(self) -> str:
        """Strictly increasing timestamps, so created_at ordering is deterministic."""
        self._clock += timedelta(seconds=1)
        return self._clock.isoformat()

    def table(self, name):
        assert name in TABLES, name
        self.queries.append(name)
        return _Query(self, name)

    def delete_rows(self, table, ids):
        """Delete rows by id, applying FK on-delete actions."""
        if not ids:
            return
        rows = self.tables[table]
        rows[:] = [r for r in rows if r["id"] not in ids]
        for child, col, parent, action in FOREIGN_KEYS:
            if parent != table:
                continue
            children = [r for r in self.tables[child] if r[col] in ids]
            if action == "cascade":
                self.delete_rows(child, {r["id"] for r in children})
            else:
                for r in children:
                    r[col] = None
