"""Nexus MCP server: projects, features, tasks and calendar events for agents, over the Nexus API.

Runs over stdio (registered in the repo's .mcp.json). Every call goes through the
Flask API with the bearer token, so writes get the API's validation and cache
invalidation and show up in the desktop app like any other client's.

Config: NEXUS_API_URL / NEXUS_API_TOKEN from the environment, else
MAIN_VITE_NEXUS_API_URL / MAIN_VITE_NEXUS_API_TOKEN from frontend/.env (the same
backend the desktop app uses), else the local default http://127.0.0.1:5001.
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_URL = "http://127.0.0.1:5001"
TIMEOUT_SECONDS = 15

Status = Literal["todo", "active", "blocked", "complete", "cancelled"]
ClearableField = Literal["description", "due_at", "feature_id"]
Scope = Literal["this", "following", "all"]
ClearableEventField = Literal["description", "category"]
# Unmodified occurrences of a series come from list_events with id <master id>_<unix start>.
OCCURRENCE_ID = re.compile(r"_\d+$")

READ = ToolAnnotations(readOnlyHint=True, idempotentHint=True, openWorldHint=False)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)

INSTRUCTIONS = """\
Nexus is Mark's personal planning app. Data model: projects contain features; tasks
belong to a project and optionally one of its features. Ids are UUID strings.

Task statuses: todo (not started), active (in progress), blocked (needs Mark's
attention before work can continue; say why in the feature notes), complete,
cancelled. There are no delete tools: cancel a task instead.

Feature notes are the shared log for a feature: design decisions, results, branch
names, open questions. Use append_feature_notes to add to them; it keeps what's there.
Use update_feature(notes=...) only to deliberately rewrite the whole text.

append_feature_notes and update_task return short acks only (ids and timestamps, plus
the task's status), not the notes or task body. Call get_feature / get_task when you
need the full text after a write.

Calendar events: list_events returns a window's events with recurring series expanded.
An event with recurring_event_id set is one occurrence of a series: to edit it, pass
update_event its recurring_event_id, original_start_at and a scope (this = only that
occurrence, following = it and later ones, all = the whole series). Events without
recurring_event_id are edited by event_id and take no scope. update_event returns only
{id, updated_at}; re-read with list_events. Events can't be deleted through these tools.
"""


class NexusError(Exception):
    """An API failure, with a message safe to show the agent (never the token)."""


def read_dotenv(path: Path) -> dict[str, str]:
    """KEY=VALUE lines of a .env file; comments and blank lines skipped."""
    values: dict[str, str] = {}
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return values
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        value = value.strip()
        if value[:1] in ("'", '"') and value.count(value[0]) >= 2:
            value = value[1 : value.index(value[0], 1)]
        else:
            value = value.split(" #", 1)[0].strip()
        values[key.strip()] = value
    return values


def load_config(env=os.environ, dotenv_path: Path = REPO_ROOT / "frontend" / ".env") -> tuple[str, str]:
    """(base url without /api, token). The token may be empty; requests then fail with a clear message."""
    file = read_dotenv(dotenv_path)
    url = env.get("NEXUS_API_URL") or file.get("MAIN_VITE_NEXUS_API_URL") or DEFAULT_URL
    token = env.get("NEXUS_API_TOKEN") or file.get("MAIN_VITE_NEXUS_API_TOKEN") or ""
    return url.rstrip("/"), token


class NexusApi:
    """Minimal JSON client for the Nexus API."""

    def __init__(self, base_url: str, token: str, opener=urllib.request.urlopen):
        self.base_url = base_url.rstrip("/")
        self._token = token
        self._open = opener

    def __repr__(self) -> str:  # keep the token out of any debug output
        return f"NexusApi({self.base_url!r})"

    def request(self, method: str, path: str, body: dict | None = None, query: dict | None = None) -> Any:
        if not self._token:
            raise NexusError("No Nexus API token: set NEXUS_API_TOKEN, or MAIN_VITE_NEXUS_API_TOKEN in frontend/.env.")
        url = f"{self.base_url}/api/v1{path}"
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self._token}")
        req.add_header("X-Nexus-Client", "agent")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with self._open(req, timeout=TIMEOUT_SECONDS) as res:
                return json.loads(res.read() or b"null")
        except ValueError:  # 2xx but not JSON (e.g. a proxy page): not the Nexus API
            raise NexusError(f"Nexus API at {self.base_url} returned a non-JSON response") from None
        except urllib.error.HTTPError as e:
            raise NexusError(f"Nexus API {e.code}: {_error_message(e)}") from None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            reason = getattr(e, "reason", e)
            raise NexusError(f"Nexus API unreachable at {self.base_url}: {reason}") from None

    def get(self, path: str, **query) -> Any:
        return self.request("GET", path, query=query or None)

    def post(self, path: str, body: dict) -> Any:
        return self.request("POST", path, body)

    def put(self, path: str, body: dict) -> Any:
        return self.request("PUT", path, body)


def _error_message(e: urllib.error.HTTPError) -> str:
    try:
        payload = json.loads(e.read())
    except (ValueError, OSError):
        return e.reason or "request failed"
    if isinstance(payload, dict) and isinstance(payload.get("error"), str):
        return payload["error"]
    return e.reason or "request failed"


def build_server(api: NexusApi) -> MCPServer:
    server = MCPServer("nexus", instructions=INSTRUCTIONS)

    def call(fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except NexusError as e:
            raise ToolError(str(e)) from None

    def project_of_feature(feature_id: str) -> str:
        return call(api.get, f"/features/{feature_id}")["project_id"]

    @server.tool(annotations=READ)
    def list_projects() -> list[dict[str, Any]]:
        """List all projects (without notes): id, title, description, type, status."""
        return call(api.get, "/projects")

    @server.tool(annotations=READ)
    def get_project(project_id: str) -> dict[str, Any]:
        """One project with its notes (the project-level notes text, may be null)."""
        return call(api.get, f"/projects/{project_id}")

    @server.tool(annotations=READ)
    def list_features(project_id: str) -> list[dict[str, Any]]:
        """A project's features (without notes): id, name, project_id, notes_updated_at, has_notes."""
        return call(api.get, f"/projects/{project_id}/features")

    @server.tool(annotations=READ)
    def get_feature(feature_id: str) -> dict[str, Any]:
        """One feature with its full notes text and `tasks`: every task in the feature, oldest first."""
        feature = call(api.get, f"/features/{feature_id}")
        return {**feature, "tasks": call(api.get, "/tasks", feature_id=feature_id)}

    @server.tool(annotations=WRITE)
    def create_feature(project_id: str, name: str) -> dict[str, Any]:
        """Add a feature to a project. Returns the new feature."""
        return call(api.post, f"/projects/{project_id}/features", {"name": name})

    @server.tool(annotations=WRITE)
    def update_feature(feature_id: str, name: str | None = None, notes: str | None = None) -> dict[str, Any]:
        """Rename a feature and/or REPLACE its whole notes text. To add to the notes, use
        append_feature_notes instead. Returns the updated feature with notes."""
        body = {k: v for k, v in {"name": name, "notes": notes}.items() if v is not None}
        if not body:
            raise ToolError("pass name and/or notes")
        return call(api.put, f"/features/{feature_id}", body)

    @server.tool(annotations=WRITE)
    def append_feature_notes(feature_id: str, text: str) -> dict[str, Any]:
        """Append text (markdown) to a feature's notes, separated from what's there by a blank
        line. Existing notes are kept (it re-reads them first, so don't append to the same
        feature from two agents at once). Returns only {id, notes_updated_at}, not the
        notes; call get_feature for the full text."""
        if not text.strip():
            raise ToolError("text is empty")
        existing = call(api.get, f"/features/{feature_id}").get("notes") or ""
        notes = f"{existing.rstrip()}\n\n{text.strip()}" if existing.strip() else text.strip()
        feature = call(api.put, f"/features/{feature_id}", {"notes": notes})
        return {"id": feature["id"], "notes_updated_at": feature.get("notes_updated_at")}

    @server.tool(annotations=READ)
    def list_tasks(
        project_id: str | None = None, feature_id: str | None = None, status: list[Status] | None = None
    ) -> list[dict[str, Any]]:
        """Tasks, oldest first, filtered by any of project_id, feature_id and status (a task
        matches if its status is any of the listed ones). With no filters, returns every task."""
        statuses = ",".join(status) if status else None
        return call(api.get, "/tasks", project_id=project_id, feature_id=feature_id, status=statuses)

    @server.tool(annotations=READ)
    def get_task(task_id: str) -> dict[str, Any]:
        """One task: title, description, status, due_at, completed_at, project_id, feature_id."""
        return call(api.get, f"/tasks/{task_id}")

    @server.tool(annotations=WRITE)
    def create_task(
        title: str,
        project_id: str | None = None,
        feature_id: str | None = None,
        description: str | None = None,
        due_at: str | None = None,
    ) -> dict[str, Any]:
        """Create a task (status todo). With feature_id, the task goes in that feature's
        project (project_id may be omitted). due_at is an ISO-8601 timestamp with offset.
        Returns the new task."""
        if feature_id:
            feature_project = project_of_feature(feature_id)
            if project_id and project_id != feature_project:
                raise ToolError(f"feature {feature_id} belongs to project {feature_project}, not {project_id}")
            project_id = feature_project
        body = {"title": title, "project_id": project_id, "feature_id": feature_id,
                "description": description, "due_at": due_at}  # fmt: skip
        return call(api.post, "/tasks", {k: v for k, v in body.items() if v is not None})

    @server.tool(annotations=WRITE)
    def update_task(
        task_id: str,
        title: str | None = None,
        description: str | None = None,
        status: Status | None = None,
        feature_id: str | None = None,
        due_at: str | None = None,
        clear: list[ClearableField] | None = None,
    ) -> dict[str, Any]:
        """Change a task; only the fields you pass change. `clear` empties fields (e.g.
        ["due_at"]). Moving to a feature also moves the task to that feature's project.
        Returns only {id, status, updated_at}; call get_task for the full task."""
        fields = {"title": title, "description": description, "status": status,
                  "feature_id": feature_id, "due_at": due_at}  # fmt: skip
        body: dict[str, Any] = {k: v for k, v in fields.items() if v is not None}
        for name in clear or []:
            if name in body:
                raise ToolError(f"{name} is both set and cleared")
            body[name] = None
        if feature_id:
            body["project_id"] = project_of_feature(feature_id)
        if not body:
            raise ToolError("nothing to change")
        task = call(api.put, f"/tasks/{task_id}", body)
        return {"id": task["id"], "status": task["status"], "updated_at": task.get("updated_at")}

    @server.tool(annotations=READ)
    def list_events(start: str, end: str) -> list[dict[str, Any]]:
        """Calendar events overlapping [start, end), sorted by start. start and end are
        ISO-8601 timestamps with offset, start before end. Keep windows small (days to a
        few weeks): recurring series are expanded into one entry per occurrence. An entry
        with recurring_event_id set is an occurrence of a series (it also carries
        original_start_at and the series' rrule); edit it with update_event and a scope.
        All-day events (all_day true) span local midnights of their timezone, end exclusive."""
        return call(api.get, "/events", start=start, end=end)

    @server.tool(annotations=WRITE)
    def create_event(
        title: str,
        start_at: str,
        end_at: str,
        all_day: bool | None = None,
        description: str | None = None,
        category: str | None = None,
        timezone: str | None = None,
        rrule: str | None = None,
    ) -> dict[str, Any]:
        """Create a calendar event. start_at / end_at are ISO-8601 timestamps with offset
        (end after start). timezone is an IANA zone (default UTC); use Mark's zone. An
        all-day event must start at midnight of its first day and end at midnight after
        its last, in its timezone. rrule makes it repeat: an RFC 5545 RRULE body without
        the "RRULE:" prefix, e.g. "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10". Returns the new event."""
        body = {"title": title, "start_at": start_at, "end_at": end_at, "all_day": all_day,
                "description": description, "category": category, "timezone": timezone, "rrule": rrule}  # fmt: skip
        return call(api.post, "/events", {k: v for k, v in body.items() if v is not None})

    @server.tool(annotations=WRITE)
    def update_event(
        event_id: str | None = None,
        recurring_event_id: str | None = None,
        original_start_at: str | None = None,
        scope: Scope | None = None,
        title: str | None = None,
        description: str | None = None,
        category: str | None = None,
        start_at: str | None = None,
        end_at: str | None = None,
        all_day: bool | None = None,
        timezone: str | None = None,
        rrule: str | None = None,
        clear: list[ClearableEventField] | None = None,
    ) -> dict[str, Any]:
        """Change a calendar event; only the fields you pass change. `clear` empties fields
        (e.g. ["category"]). Timestamps are ISO-8601 with offset.

        A plain event (no recurring_event_id in list_events): pass event_id, no scope. Its
        rrule may be set to make it a series.

        An occurrence of a series (recurring_event_id set in list_events, edited or not):
        pass its recurring_event_id and original_start_at, unchanged from list_events, and
        scope: "this" (only that occurrence), "following" (it and later ones) or "all" (the
        whole series). There is no default scope. rrule can't be changed here.

        Returns only {id, updated_at}; re-read with list_events."""
        fields = {"title": title, "description": description, "category": category, "start_at": start_at,
                  "end_at": end_at, "all_day": all_day, "timezone": timezone, "rrule": rrule}  # fmt: skip
        body: dict[str, Any] = {k: v for k, v in fields.items() if v is not None}
        for name in clear or []:
            if name in body:
                raise ToolError(f"{name} is both set and cleared")
            body[name] = None

        if recurring_event_id or original_start_at:
            if not (recurring_event_id and original_start_at):
                raise ToolError("a recurring occurrence needs both recurring_event_id and original_start_at")
            if not scope:
                raise ToolError("editing a recurring occurrence needs scope: this, following or all")
            if rrule is not None:
                raise ToolError("rrule can only be changed on a plain event")
            if not body:
                raise ToolError("nothing to change")
            start = urllib.parse.quote(original_start_at, safe="")
            event = call(api.put, f"/events/{recurring_event_id}/occurrences/{start}", {**body, "scope": scope})
        else:
            if not event_id:
                raise ToolError("pass event_id, or recurring_event_id + original_start_at + scope")
            if scope:
                raise ToolError("scope is only for recurring occurrences (recurring_event_id + original_start_at)")
            if OCCURRENCE_ID.search(event_id):
                raise ToolError(
                    f"{event_id} is an occurrence of a series: pass its recurring_event_id, original_start_at and scope"
                )
            if not body:
                raise ToolError("nothing to change")
            event = call(api.put, f"/events/{event_id}", body)
        return {"id": event["id"], "updated_at": event.get("updated_at")}

    return server


def main():
    build_server(NexusApi(*load_config())).run()


if __name__ == "__main__":
    main()
