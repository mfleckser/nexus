"""Tool layer against an in-memory fake of the Nexus API, called through MCPServer so
argument schemas and error handling are exercised too. Run from tools/nexus-mcp:
venv/bin/python -m unittest discover -s tests"""

import io
import itertools
import json
import sys
import unittest
import urllib.error
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mcp.server.mcpserver.exceptions import ToolError  # noqa: E402

import server  # noqa: E402
from server import NexusApi, NexusError, build_server, load_config, read_dotenv  # noqa: E402


class FakeApi:
    """Just enough of the API's routes and semantics for the tools."""

    def __init__(self):
        self.ids = (f"id-{n}" for n in itertools.count(1))
        self.clock = (f"2026-11-18T12:00:{n:02d}+00:00" for n in itertools.count())
        self.projects = {"p1": {"id": "p1", "title": "Nexus", "status": "active"}}
        self.notes = {"p1": "project notes"}
        self.features: dict[str, dict] = {}
        self.tasks: dict[str, dict] = {}
        self.events: dict[str, dict] = {}
        self.calls: list[tuple] = []

    def _missing(self, what):
        raise NexusError(f"Nexus API 404: {what} not found")

    def request(self, method, path, body=None, query=None):
        self.calls.append((method, path, body, query))
        parts = path.strip("/").split("/")
        match (method, parts):
            case ("GET", ["projects"]):
                return list(self.projects.values())
            case ("GET", ["projects", pid]):
                if pid not in self.projects:
                    self._missing(f"project {pid}")
                return {**self.projects[pid], "notes": self.notes.get(pid)}
            case ("GET", ["projects", pid, "notes"]):
                return {"notes": self.notes.get(pid)} if pid in self.projects else self._missing(f"project {pid}")
            case ("GET", ["projects", pid, "features"]):
                return [{k: v for k, v in f.items() if k != "notes"} for f in self.features.values()
                        if f["project_id"] == pid]  # fmt: skip
            case ("POST", ["projects", pid, "features"]):
                f = {"id": next(self.ids), "project_id": pid, "name": body["name"], "notes": None}
                self.features[f["id"]] = f
                return f
            case ("GET", ["features", fid]):
                return dict(self.features[fid]) if fid in self.features else self._missing(f"feature {fid}")
            case ("PUT", ["features", fid]):
                if fid not in self.features:
                    self._missing(f"feature {fid}")
                now = next(self.clock)
                self.features[fid].update(body, updated_at=now)
                if "notes" in body:
                    self.features[fid]["notes_updated_at"] = now
                return dict(self.features[fid])
            case ("GET", ["tasks"]):
                q = {k: v for k, v in (query or {}).items() if v is not None}
                statuses = q["status"].split(",") if "status" in q else None
                return [t for t in self.tasks.values()
                        if all(t[k] == q[k] for k in ("project_id", "feature_id") if k in q)
                        and (statuses is None or t["status"] in statuses)]  # fmt: skip
            case ("POST", ["tasks"]):
                t = {"id": next(self.ids), "status": "todo", "description": None, "due_at": None,
                     "project_id": None, "feature_id": None, **body}  # fmt: skip
                self.tasks[t["id"]] = t
                return t
            case ("GET", ["tasks", tid]):
                return dict(self.tasks[tid]) if tid in self.tasks else self._missing(f"task {tid}")
            case ("PUT", ["tasks", tid]):
                if tid not in self.tasks:
                    self._missing(f"task {tid}")
                if body.get("status") == "done":
                    raise NexusError("Nexus API 400: status must be one of todo, active, blocked, complete, cancelled")
                self.tasks[tid].update(body, updated_at=next(self.clock))
                return dict(self.tasks[tid])
            case ("GET", ["events"]):
                return sorted(self.events.values(), key=lambda e: e["start_at"])
            case ("POST", ["events"]):
                self._check_all_day(body)
                e = {"id": next(self.ids), "all_day": False, "description": None, "category": None,
                     "timezone": "UTC", "rrule": None, "recurring_event_id": None, "original_start_at": None,
                     "updated_at": next(self.clock), **body}  # fmt: skip
                self.events[e["id"]] = e
                return e
            case ("PUT", ["events", eid]):
                if eid not in self.events:
                    self._missing(f"event {eid}")
                self._check_all_day({**self.events[eid], **body})
                self.events[eid].update(body, updated_at=next(self.clock))
                return dict(self.events[eid])
            case ("PUT", ["events", eid, "occurrences", start]):
                if body.get("scope") not in ("this", "following", "all"):
                    raise NexusError("Nexus API 400: scope must be one of this, following, all")
                if eid == "changed-elsewhere":
                    raise NexusError("Nexus API 409: This event was changed elsewhere. Try again.")
                if eid not in self.events:
                    self._missing(f"event {eid}")
                fields = {k: v for k, v in body.items() if k != "scope"}
                if body["scope"] != "this":
                    self.events[eid].update(fields, updated_at=next(self.clock))
                    return dict(self.events[eid])
                o = {**self.events[eid], "id": next(self.ids), "recurring_event_id": eid,
                     "original_start_at": urllib.parse.unquote(start), "updated_at": next(self.clock),
                     **fields}  # fmt: skip
                self.events[o["id"]] = o
                return o
        raise AssertionError(f"unexpected {method} {path}")

    def _check_all_day(self, event):
        if event.get("all_day") and not all("T00:00:00" in event[k] for k in ("start_at", "end_at")):
            raise NexusError("Nexus API 400: an all-day event must start and end at midnight in its timezone")

    def get(self, path, **query):
        return self.request("GET", path, query=query or None)

    def post(self, path, body):
        return self.request("POST", path, body)

    def put(self, path, body):
        return self.request("PUT", path, body)


class ToolsTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api = FakeApi()
        self.server = build_server(self.api)

    async def call(self, tool, /, **args):
        result = await self.server.call_tool(tool, args)
        self.assertFalse(result.is_error)
        data = result.structured_content
        # List returns are wrapped as {"result": [...]}.
        return data["result"] if set(data) == {"result"} else data

    async def test_projects(self):
        self.assertEqual([p["id"] for p in await self.call("list_projects")], ["p1"])
        self.assertEqual((await self.call("get_project", project_id="p1"))["notes"], "project notes")
        with self.assertRaisesRegex(ToolError, "Nexus API 404: project nope not found"):
            await self.call("get_project", project_id="nope")

    async def test_features_and_notes(self):
        f = await self.call("create_feature", project_id="p1", name="Agent tools")
        self.assertEqual([x["name"] for x in await self.call("list_features", project_id="p1")], ["Agent tools"])

        first = await self.call("append_feature_notes", feature_id=f["id"], text="\n## Decisions\n- MCP server\n")
        self.assertEqual(first, {"id": f["id"], "notes_updated_at": "2026-11-18T12:00:00+00:00"})
        self.assertEqual((await self.call("get_feature", feature_id=f["id"]))["notes"], "## Decisions\n- MCP server")
        second = await self.call("append_feature_notes", feature_id=f["id"], text="Result: shipped")
        self.assertEqual(second, {"id": f["id"], "notes_updated_at": "2026-11-18T12:00:01+00:00"})
        got = await self.call("get_feature", feature_id=f["id"])
        self.assertEqual(got["notes"], "## Decisions\n- MCP server\n\nResult: shipped")
        with self.assertRaisesRegex(ToolError, "text is empty"):
            await self.call("append_feature_notes", feature_id=f["id"], text="  \n")

        renamed = await self.call("update_feature", feature_id=f["id"], name="Agent tooling", notes="rewritten")
        self.assertEqual((renamed["name"], renamed["notes"]), ("Agent tooling", "rewritten"))
        with self.assertRaisesRegex(ToolError, "pass name and/or notes"):
            await self.call("update_feature", feature_id=f["id"])

        t = await self.call("create_task", title="Build it", feature_id=f["id"])
        got = await self.call("get_feature", feature_id=f["id"])
        self.assertEqual((got["notes"], [x["id"] for x in got["tasks"]]), ("rewritten", [t["id"]]))

    async def test_create_task_fills_project_from_feature(self):
        f = await self.call("create_feature", project_id="p1", name="F")
        t = await self.call("create_task", title="T", feature_id=f["id"], description="d")
        self.assertEqual(
            (t["project_id"], t["feature_id"], t["description"], t["status"]), ("p1", f["id"], "d", "todo")
        )
        with self.assertRaisesRegex(ToolError, "belongs to project p1, not p2"):
            await self.call("create_task", title="T", feature_id=f["id"], project_id="p2")
        loose = await self.call("create_task", title="Loose")
        self.assertEqual(self.api.calls[-1], ("POST", "/tasks", {"title": "Loose"}, None))
        self.assertIsNone(loose["project_id"])

    async def test_list_and_get_tasks(self):
        f = await self.call("create_feature", project_id="p1", name="F")
        a = await self.call("create_task", title="a", feature_id=f["id"])
        b = await self.call("create_task", title="b", project_id="p1")
        await self.call("update_task", task_id=b["id"], status="blocked")
        self.assertEqual(await self.call("get_task", task_id=a["id"]), a)
        self.assertEqual([t["title"] for t in await self.call("list_tasks", project_id="p1")], ["a", "b"])
        blocked = await self.call("list_tasks", status=["blocked", "active"])
        self.assertEqual([t["title"] for t in blocked], ["b"])
        self.assertEqual(self.api.calls[-1][3], {"project_id": None, "feature_id": None, "status": "blocked,active"})
        with self.assertRaises(ToolError):  # schema rejects unknown statuses before any request
            await self.call("list_tasks", status=["done"])

    async def test_update_task(self):
        f = await self.call("create_feature", project_id="p1", name="F")
        t = await self.call("create_task", title="T", due_at="2026-12-01T17:00:00Z", description="d")
        moved = await self.call("update_task", task_id=t["id"], feature_id=f["id"], status="active")
        self.assertEqual(moved, {"id": t["id"], "status": "active", "updated_at": "2026-11-18T12:00:00+00:00"})
        got = await self.call("get_task", task_id=t["id"])
        self.assertEqual((got["feature_id"], got["project_id"], got["title"]), (f["id"], "p1", "T"))
        cleared = await self.call("update_task", task_id=t["id"], clear=["due_at", "description"])
        self.assertEqual(set(cleared), {"id", "status", "updated_at"})
        got = await self.call("get_task", task_id=t["id"])
        self.assertEqual((got["due_at"], got["description"]), (None, None))
        with self.assertRaisesRegex(ToolError, "both set and cleared"):
            await self.call("update_task", task_id=t["id"], due_at="2026-12-02T00:00:00Z", clear=["due_at"])
        with self.assertRaisesRegex(ToolError, "nothing to change"):
            await self.call("update_task", task_id=t["id"])
        with self.assertRaises(ToolError):
            await self.call("update_task", task_id=t["id"], status="done")

    async def test_list_events(self):
        events = await self.call("list_events", start="2026-11-16T00:00:00-05:00", end="2026-11-23T00:00:00-05:00")
        self.assertEqual(events, [])
        self.assertEqual(
            self.api.calls[-1],
            ("GET", "/events", None, {"start": "2026-11-16T00:00:00-05:00", "end": "2026-11-23T00:00:00-05:00"}),
        )

    async def test_create_event(self):
        e = await self.call(
            "create_event", title="Dentist", start_at="2026-12-01T09:00:00-05:00", end_at="2026-12-01T10:00:00-05:00"
        )
        self.assertEqual(
            self.api.calls[-1],
            (
                "POST",
                "/events",
                {"title": "Dentist", "start_at": "2026-12-01T09:00:00-05:00", "end_at": "2026-12-01T10:00:00-05:00"},
                None,
            ),  # fmt: skip
        )
        self.assertEqual((e["title"], e["all_day"]), ("Dentist", False))
        weekly = await self.call(
            "create_event", title="Gym", start_at="2026-12-01T07:00:00-05:00", end_at="2026-12-01T08:00:00-05:00",
            all_day=False, category="health", timezone="America/New_York", rrule="FREQ=WEEKLY;BYDAY=TU",
        )  # fmt: skip
        self.assertEqual(
            {k: self.api.calls[-1][2][k] for k in ("all_day", "category", "timezone", "rrule")},
            {"all_day": False, "category": "health", "timezone": "America/New_York", "rrule": "FREQ=WEEKLY;BYDAY=TU"},
        )
        self.assertEqual(weekly["rrule"], "FREQ=WEEKLY;BYDAY=TU")
        with self.assertRaisesRegex(ToolError, "Nexus API 400: an all-day event must start and end at midnight"):
            await self.call(
                "create_event", title="Trip", all_day=True,
                start_at="2026-12-01T09:00:00-05:00", end_at="2026-12-03T00:00:00-05:00",
            )  # fmt: skip

    async def test_update_plain_event(self):
        e = await self.call(
            "create_event", title="Call", start_at="2026-12-01T09:00:00Z", end_at="2026-12-01T10:00:00Z",
            description="d", category="work",
        )  # fmt: skip
        ack = await self.call("update_event", event_id=e["id"], title="Call Bob", clear=["category"])
        self.assertEqual(ack, {"id": e["id"], "updated_at": "2026-11-18T12:00:01+00:00"})
        self.assertEqual(self.api.calls[-1][:3], ("PUT", f"/events/{e['id']}", {"title": "Call Bob", "category": None}))
        self.assertEqual(
            (self.api.events[e["id"]]["title"], self.api.events[e["id"]]["description"]), ("Call Bob", "d")
        )
        await self.call("update_event", event_id=e["id"], rrule="FREQ=DAILY;COUNT=3")
        self.assertEqual(self.api.calls[-1][2], {"rrule": "FREQ=DAILY;COUNT=3"})

        errors = [
            ({}, "pass event_id, or recurring_event_id"),
            ({"event_id": e["id"]}, "nothing to change"),
            ({"event_id": e["id"], "scope": "all", "title": "x"}, "scope is only for recurring occurrences"),
            ({"event_id": f"{e['id']}_1764579600", "title": "x"}, "is an occurrence of a series"),
            ({"event_id": e["id"], "category": "c", "clear": ["category"]}, "category is both set and cleared"),
            ({"event_id": e["id"], "all_day": True}, "Nexus API 400: an all-day event must start and end at midnight"),
            ({"event_id": "nope", "title": "x"}, "Nexus API 404: event nope not found"),
        ]
        for args, message in errors:
            calls = len(self.api.calls)
            with self.subTest(args=args), self.assertRaisesRegex(ToolError, message):
                await self.call("update_event", **args)
            if not message.startswith("Nexus API"):
                self.assertEqual(len(self.api.calls), calls)  # rejected before any request

    async def test_update_recurring_occurrence(self):
        series = await self.call(
            "create_event", title="Standup", start_at="2026-12-01T09:00:00-05:00",
            end_at="2026-12-01T09:15:00-05:00", rrule="FREQ=DAILY",
        )  # fmt: skip
        occurrence = {"recurring_event_id": series["id"], "original_start_at": "2026-12-02T09:00:00-05:00"}
        ack = await self.call("update_event", **occurrence, scope="this", title="Standup (late)",
                              start_at="2026-12-02T10:00:00-05:00", end_at="2026-12-02T10:15:00-05:00")  # fmt: skip
        self.assertEqual(set(ack), {"id", "updated_at"})
        self.assertNotEqual(ack["id"], series["id"])
        self.assertEqual(
            self.api.calls[-1],
            ("PUT", f"/events/{series['id']}/occurrences/2026-12-02T09%3A00%3A00-05%3A00",
             {"title": "Standup (late)", "start_at": "2026-12-02T10:00:00-05:00",
              "end_at": "2026-12-02T10:15:00-05:00", "scope": "this"}, None),
        )  # fmt: skip
        self.assertEqual(self.api.events[ack["id"]]["original_start_at"], "2026-12-02T09:00:00-05:00")

        ack = await self.call("update_event", **occurrence, scope="all", clear=["description"])
        self.assertEqual(ack, {"id": series["id"], "updated_at": self.api.events[series["id"]]["updated_at"]})
        self.assertEqual(self.api.calls[-1][2], {"description": None, "scope": "all"})
        # An event_id passed along (e.g. the occurrence's own id) is ignored for recurring edits.
        await self.call("update_event", event_id=f"{series['id']}_1764684000", **occurrence, scope="following",
                        title="x")  # fmt: skip
        self.assertEqual(self.api.calls[-1][1], f"/events/{series['id']}/occurrences/2026-12-02T09%3A00%3A00-05%3A00")

        errors = [
            ({**occurrence, "title": "x"}, "needs scope: this, following or all"),
            ({"recurring_event_id": series["id"], "scope": "this", "title": "x"}, "needs both recurring_event_id"),
            ({"original_start_at": occurrence["original_start_at"], "scope": "this", "title": "x"}, "needs both"),
            ({**occurrence, "scope": "all", "rrule": "FREQ=WEEKLY"}, "rrule can only be changed on a plain event"),
            ({**occurrence, "scope": "this"}, "nothing to change"),
        ]
        for args, message in errors:
            calls = len(self.api.calls)
            with self.subTest(args=args), self.assertRaisesRegex(ToolError, message):
                await self.call("update_event", **args)
            self.assertEqual(len(self.api.calls), calls)
        with self.assertRaises(ToolError):  # schema rejects unknown scopes before any request
            await self.call("update_event", **occurrence, scope="some", title="x")
        with self.assertRaisesRegex(ToolError, "Nexus API 409: This event was changed elsewhere. Try again."):
            await self.call("update_event", recurring_event_id="changed-elsewhere",
                            original_start_at="2026-12-02T09:00:00Z", scope="all", title="x")  # fmt: skip

    async def test_api_errors_reach_the_agent(self):
        with self.assertRaisesRegex(ToolError, r"Nexus API 404: task nope not found"):
            await self.call("get_task", task_id="nope")


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class ApiClientTest(unittest.TestCase):
    def test_request_shape(self):
        seen = {}

        def opener(req, timeout):
            seen.update(url=req.full_url, method=req.get_method(), auth=req.get_header("Authorization"),
                        body=req.data, ctype=req.get_header("Content-type"))  # fmt: skip
            return FakeResponse(b'[{"id": "t1"}]')

        api = NexusApi("http://pi:5001/", "secret-token", opener=opener)
        self.assertEqual(api.get("/tasks", status="todo,blocked", project_id=None), [{"id": "t1"}])
        self.assertEqual(seen["url"], "http://pi:5001/api/tasks?status=todo%2Cblocked")
        self.assertEqual((seen["method"], seen["auth"], seen["body"]), ("GET", "Bearer secret-token", None))
        api.put("/tasks/t1", {"status": "blocked"})
        self.assertEqual((seen["method"], json.loads(seen["body"]), seen["ctype"]),
                         ("PUT", {"status": "blocked"}, "application/json"))  # fmt: skip

    def test_errors(self):
        def http_error(req, timeout):
            raise urllib.error.HTTPError(
                req.full_url, 400, "BAD REQUEST", {}, io.BytesIO(b'{"error": "title cannot be null"}')
            )

        def html_error(req, timeout):
            raise urllib.error.HTTPError(req.full_url, 502, "Bad Gateway", {}, io.BytesIO(b"<html>"))

        def unreachable(req, timeout):
            raise urllib.error.URLError(ConnectionRefusedError(61, "Connection refused"))

        def html_ok(req, timeout):
            return FakeResponse(b"<html>tailscale</html>")

        cases = [(http_error, "Nexus API 400: title cannot be null"), (html_error, "Nexus API 502: Bad Gateway"),
                 (unreachable, "unreachable at http://pi"), (html_ok, "non-JSON response")]  # fmt: skip
        for opener, message in cases:
            with self.subTest(message=message), self.assertRaises(NexusError) as ctx:
                NexusApi("http://pi", "secret-token", opener=opener).get("/tasks")
            self.assertIn(message, str(ctx.exception))
            self.assertNotIn("secret-token", str(ctx.exception))

    def test_missing_token_and_repr(self):
        with self.assertRaisesRegex(NexusError, "No Nexus API token"):
            NexusApi("http://pi", "").get("/tasks")
        self.assertNotIn("secret-token", repr(NexusApi("http://pi", "secret-token")))


class ConfigTest(unittest.TestCase):
    def setUp(self):
        import tempfile

        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.dotenv = Path(self.dir.name) / ".env"
        self.dotenv.write_text(
            "# comment\n# MAIN_VITE_NEXUS_API_URL=https://commented.example\n"
            "MAIN_VITE_NEXUS_API_TOKEN='file-token'\n\nBROKEN LINE\n"
            "export OTHER=plain # inline comment\nHASH='a # b'\n"
        )

    def test_dotenv_parsing(self):
        self.assertEqual(
            read_dotenv(self.dotenv), {"MAIN_VITE_NEXUS_API_TOKEN": "file-token", "OTHER": "plain", "HASH": "a # b"}
        )
        self.assertEqual(read_dotenv(Path(self.dir.name) / "missing"), {})

    def test_precedence(self):
        self.assertEqual(load_config({}, self.dotenv), (server.DEFAULT_URL, "file-token"))
        self.dotenv.write_text("MAIN_VITE_NEXUS_API_URL=https://pi.ts.net/\nMAIN_VITE_NEXUS_API_TOKEN=f\n")
        self.assertEqual(load_config({}, self.dotenv), ("https://pi.ts.net", "f"))
        env = {"NEXUS_API_URL": "http://127.0.0.1:5055", "NEXUS_API_TOKEN": "env-token"}
        self.assertEqual(load_config(env, self.dotenv), ("http://127.0.0.1:5055", "env-token"))


if __name__ == "__main__":
    unittest.main()
