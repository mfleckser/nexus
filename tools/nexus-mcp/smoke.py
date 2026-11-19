"""Live smoke test: spawns server.py over stdio like Claude Code does and drives the tools
against a real backend. Writes only "ZZ test" rows and deletes them afterwards.

    venv/bin/python smoke.py                         # backend from frontend/.env
    NEXUS_API_URL=http://127.0.0.1:5055 venv/bin/python smoke.py
"""

import json
import os
import sys
from pathlib import Path

import anyio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from server import NexusApi, load_config

HERE = Path(__file__).resolve().parent


async def main() -> int:
    api = NexusApi(*load_config())  # setup/cleanup only: the tools have no project create/delete
    project = api.post("/projects", {"title": "ZZ test MCP smoke", "description": "", "type": "coding"})
    task_ids: list[str] = []
    event_ids: list[str] = []
    failures: list[str] = []

    def check(name: str, ok: bool, detail: str = ""):
        print(f"{'PASS' if ok else 'FAIL'} {name} {detail}".rstrip())
        if not ok:
            failures.append(name)

    params = StdioServerParameters(command=sys.executable, args=[str(HERE / "server.py")], env=dict(os.environ))
    try:
        async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
            await session.initialize()

            async def call(tool: str, **args):
                result = await session.call_tool(tool, args)
                text = result.content[0].text if result.content else ""
                if result.is_error:
                    return None, text
                data = result.structured_content
                return (data["result"] if set(data) == {"result"} else data), text

            tools = {t.name for t in (await session.list_tools()).tools}
            check("tools listed", len(tools) == 14, str(sorted(tools)))

            got, _ = await call("get_project", project_id=project["id"])
            check("get_project", got and got["title"] == "ZZ test MCP smoke")
            feature, _ = await call("create_feature", project_id=project["id"], name="ZZ smoke feature")
            fid = feature["id"]
            t1, _ = await call("create_task", title="ZZ smoke task 1", feature_id=fid)
            task_ids.append(t1["id"])
            t2, _ = await call("create_task", title="ZZ smoke task 2", feature_id=fid, description="d")
            task_ids.append(t2["id"])
            check("create_task fills project", t1["project_id"] == project["id"])

            blocked, _ = await call("update_task", task_id=t2["id"], status="blocked")
            check(
                "update_task ack",
                blocked and set(blocked) == {"id", "status", "updated_at"} and blocked["status"] == "blocked",
            )
            listed, _ = await call("list_tasks", feature_id=fid, status=["blocked"])
            check("list_tasks filter", [t["id"] for t in listed] == [t2["id"]])
            one, _ = await call("get_task", task_id=t1["id"])
            check("get_task", one and one["title"] == "ZZ smoke task 1")

            await call("append_feature_notes", feature_id=fid, text="## Decisions\n- smoke")
            noted, _ = await call("append_feature_notes", feature_id=fid, text="Result: ok")
            check("append_feature_notes ack", noted and set(noted) == {"id", "notes_updated_at"})
            full, _ = await call("get_feature", feature_id=fid)
            check("append_feature_notes", full["notes"] == "## Decisions\n- smoke\n\nResult: ok")
            check("get_feature tasks", sorted(t["id"] for t in full["tasks"]) == sorted(task_ids))
            features, _ = await call("list_features", project_id=project["id"])
            check("list_features", [f["name"] for f in features] == ["ZZ smoke feature"])

            _, error = await call("update_task", task_id=t1["id"], title="   ")
            check("API error surfaced", "Nexus API 400" in error, json.dumps(error))
            _, error = await call("get_task", task_id="00000000-0000-0000-0000-000000000000")
            check("404 surfaced", "Nexus API 404" in error, json.dumps(error))

            # Events, far in the future so they stay out of Mark's calendar views.
            window = {"start": "2031-03-03T00:00:00-05:00", "end": "2031-03-10T00:00:00-05:00"}
            plain, _ = await call("create_event", title="ZZ test smoke event", timezone="America/New_York",
                                  start_at="2031-03-04T09:00:00-05:00", end_at="2031-03-04T10:00:00-05:00")  # fmt: skip
            event_ids.append(plain["id"])
            listed, _ = await call("list_events", **window)
            check("list_events", plain["id"] in [e["id"] for e in listed])
            ack, _ = await call("update_event", event_id=plain["id"], title="ZZ test smoke event 2",
                                start_at="2031-03-04T11:00:00-05:00", end_at="2031-03-04T12:00:00-05:00")  # fmt: skip
            check("update_event ack", ack and set(ack) == {"id", "updated_at"} and ack["id"] == plain["id"])
            got = next(e for e in (await call("list_events", **window))[0] if e["id"] == plain["id"])
            moved = got["title"] == "ZZ test smoke event 2" and got["start_at"].startswith("2031-03-04T16:00")
            check("update_event plain", moved, f"{got['title']} {got['start_at']}")
            _, error = await call("update_event", event_id=plain["id"], all_day=True)
            check("all-day 400 surfaced", "Nexus API 400" in error and "midnight" in error, json.dumps(error))

            series, _ = await call("create_event", title="ZZ test smoke series", timezone="America/New_York",
                                   start_at="2031-03-04T08:00:00-05:00", end_at="2031-03-04T08:30:00-05:00",
                                   rrule="FREQ=DAILY;COUNT=3")  # fmt: skip
            event_ids.append(series["id"])
            listed, _ = await call("list_events", **window)
            occurrences = [e for e in listed if e.get("recurring_event_id") == series["id"]]
            check("list_events expands series", len(occurrences) == 3, str(len(occurrences)))
            second = occurrences[1]
            target = {"recurring_event_id": series["id"], "original_start_at": second["original_start_at"]}
            _, error = await call("update_event", **target, title="ZZ test smoke moved")
            check("recurring edit needs scope", "needs scope" in error, json.dumps(error))
            ack, _ = await call("update_event", **target, scope="this", title="ZZ test smoke moved")
            check("update_event this ack", ack and set(ack) == {"id", "updated_at"})
            listed, _ = await call("list_events", **window)
            titles = [e["title"] for e in listed if e.get("recurring_event_id") == series["id"]]
            expected = ["ZZ test smoke series", "ZZ test smoke moved", "ZZ test smoke series"]
            check("update_event this", titles == expected, str(titles))
    finally:
        # Tasks first: deleting the project only nulls their project_id. Deleting a series
        # master also deletes its overrides.
        paths = [f"/tasks/{task_id}" for task_id in task_ids] + [f"/projects/{project['id']}"]
        for path in paths + [f"/events/{event_id}" for event_id in event_ids]:
            try:
                api.request("DELETE", path)
            except Exception as e:  # keep cleaning up; report what's left behind
                print(f"CLEANUP FAILED {path}: {e}")
    print("cleaned up")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(anyio.run(main))
