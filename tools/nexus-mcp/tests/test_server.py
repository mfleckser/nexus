"""Tool layer against an in-memory fake of the Nexus API, called through MCPServer so
argument schemas and error handling are exercised too. Run from tools/nexus-mcp:
venv/bin/python -m unittest discover -s tests"""

import io
import itertools
import json
import sys
import unittest
import urllib.error
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
        raise AssertionError(f"unexpected {method} {path}")

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
