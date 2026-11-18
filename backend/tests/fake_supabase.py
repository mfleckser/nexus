"""Minimal in-memory stand-in for the supabase-py query builder, covering only
what the services use. Timestamps are stored the way PostgREST returns them
(UTC ISO with +00:00) and compared as instants. A few Postgres behaviors are
mimicked because the API maps them to status codes: NOT NULL (23502), CHECK
(23514), UNIQUE (23505), FK to a missing master (23503), invalid uuid /
timestamp text (22P02 / 22007), and FK on-delete cascade / set null.
`rpc("apply_event_writes")` mirrors the SQL function of that name,
all-or-nothing like a Postgres transaction, incl. its stale-write guard (PT409)."""

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
        "unique": ("recurring_event_id", "original_start_at"),  # deferrable in SQL
    },
    "tasks": {
        "defaults": {
            "title": None, "description": None, "status": "todo", "due_at": None, "completed_at": None,
            "project_id": None, "feature_id": None, "event_id": None,
        },
        "not_null": {"title"},
        "checks": {"status": {None, "todo", "active", "blocked", "complete", "cancelled"}},
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
CHECKED_FOREIGN_KEYS = {("events", "recurring_event_id"), ("tasks", "event_id")}


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
        self.columns = None  # None = all

    def select(self, *columns):
        names = [c.strip() for col in columns for c in col.split(",")]
        self.columns = None if names in ([], ["*"]) else names
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
            out = [{c: r[c] for c in self.columns} if self.columns else r for r in match[: self.row_limit]]
            return _Result(copy.deepcopy(out))
        if self.op == "insert":
            now = self.db.tick()
            row = {"id": str(uuid.uuid4()), "created_at": now, "updated_at": now}
            row.update(copy.deepcopy(TABLES[self.table]["defaults"]))
            row.update({k: _store(k, v) for k, v in self.payload.items()})
            self._check_values(row, row.keys())
            self.db.check_foreign_keys(self.table, [row])
            rows.append(row)
            try:
                self.db.check_unique(self.table)
            except PostgrestAPIError:
                rows.remove(row)  # the statement fails as a whole
                raise
            return _Result([copy.deepcopy(row)])
        if self.op == "update":
            if not self.payload:
                raise RuntimeError("empty update")  # PostgREST rejects these too
            values = {k: _store(k, v) for k, v in self.payload.items()}
            self._check_values(values, values.keys())
            now = self.db.tick()
            self.db.check_foreign_keys(self.table, [{**r, **values} for r in match])
            before = copy.deepcopy(match)
            for r in match:
                r.update(values, updated_at=now)
            try:
                self.db.check_unique(self.table)
            except PostgrestAPIError:
                for r, old in zip(match, before, strict=True):
                    r.clear()
                    r.update(old)
                raise
            return _Result([copy.deepcopy(r) for r in match])
        self.db.delete_rows(self.table, {r["id"] for r in match})
        return _Result([copy.deepcopy(r) for r in match])


class _Rpc:
    """apply_event_writes: run the ops in order; on any error restore every
    table, as the SQL function's transaction would roll back."""

    def __init__(self, db, ops, result_id):
        self.db = db
        self.ops = copy.deepcopy(ops)
        self.result_id = result_id

    def execute(self):
        db = self.db
        if db.fail_on == "rpc":
            raise RuntimeError("simulated DB failure")
        self._check_expected()
        snapshot = copy.deepcopy(db.tables)
        db.in_rpc = True
        try:
            for i, op in enumerate(self.ops):
                if db.fail_after_ops is not None and i >= db.fail_after_ops:
                    raise RuntimeError("simulated DB failure mid-transaction")
                self._apply(op)
            db.in_rpc = False
            db.check_unique("events")
        except Exception:
            for name, rows in snapshot.items():
                db.tables[name][:] = rows
            raise
        finally:
            db.in_rpc = False
        rows = [r for r in db.tables["events"] if r["id"] == self.result_id]
        return _Result(copy.deepcopy(rows))

    def _check_expected(self):
        """Stale-write guard, before any op runs: an update / delete op with
        expect_updated_at fails the call if its row is gone or changed."""
        rows = {r["id"]: r for r in self.db.tables["events"]}
        for op in self.ops:
            expected = op.get("expect_updated_at") if op["op"] in ("update", "delete") else None
            if expected is None:
                continue
            row = rows.get(op["id"])
            if row is None or _instant(row["updated_at"]) != _instant(expected):
                raise _pg_error("PT409", f"event {op['id']} was changed elsewhere")

    def _apply(self, op):
        q = _Query(self.db, "events")
        kind = op["op"]
        if kind == "insert":
            q.insert(op["row"]).execute()
        elif kind == "update":
            if not q.update(op["set"]).eq("id", op["id"]).execute().data:
                raise _pg_error("P0002", f"event {op['id']} not found")
        elif kind == "delete":
            q.delete().eq("id", op["id"]).execute()
        elif kind == "delete_overrides":
            q = q.delete().eq("recurring_event_id", op["master"])
            if op.get("from"):
                q = q.gte("original_start_at", op["from"])
            if op.get("at"):
                q = q.eq("original_start_at", op["at"])
            q.execute()
        elif kind == "relink_tasks":
            if not op.get("from") or not op.get("to"):
                raise _pg_error("22023", "relink_tasks needs from and to")
            _Query(self.db, "tasks").update({"event_id": op["to"]}).eq("event_id", op["from"]).execute()
        else:
            raise _pg_error("22023", f"unknown op {kind!r}")


class FakeSupabase:
    def __init__(self):
        self.tables = {name: [] for name in TABLES}
        self.rows = self.tables["events"]  # back-compat for the event tests
        self.fail_on = None  # set to "update"/"insert"/"rpc"/... to simulate a failure
        self.fail_after_ops = None  # an rpc fails after applying this many of its ops
        self.in_rpc = False  # unique checks are deferred to the end of an rpc
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

    def check_unique(self, table):
        cols = TABLES[table].get("unique")
        if not cols or self.in_rpc:
            return
        seen = set()
        for r in self.tables[table]:
            key = tuple(_cmp(c, r[c]) if r[c] is not None else None for c in cols)
            if None in key:
                continue  # NULLs are distinct in a unique constraint
            if key in seen:
                raise _pg_error("23505", f'duplicate key value violates unique constraint on "{table}"')
            seen.add(key)

    def rpc(self, name, params):
        assert name == "apply_event_writes", name
        self.queries.append(f"rpc:{name}")
        return _Rpc(self, params["ops"], params.get("result_id"))

    def check_foreign_keys(self, table, rows):
        """Only events.recurring_event_id and tasks.event_id are checked (other
        tests use made-up ids)."""
        for child, col, parent, _ in FOREIGN_KEYS:
            if (child, col) not in CHECKED_FOREIGN_KEYS or child != table:
                continue
            ids = {r["id"] for r in self.tables[parent]}
            for r in rows:
                if r.get(col) is not None and r[col] not in ids:
                    raise _pg_error("23503", f'insert or update on table "{table}" violates foreign key on "{col}"')

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
