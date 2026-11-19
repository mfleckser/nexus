"""backend/openapi.json matches the app: the same routes, under /api/v1 and the
/api alias, and responses that validate against its schemas."""

import json
import re
import unittest
from pathlib import Path

from app_case import AppTestCase

SPEC = json.loads((Path(__file__).resolve().parents[1] / "openapi.json").read_text())
METHODS = {"get", "post", "put", "delete", "patch"}
WEEKLY = {
    "title": "Standup",
    "start_at": "2026-09-30T16:00:00Z",
    "end_at": "2026-09-30T17:00:00Z",
    "timezone": "America/Los_Angeles",
    "rrule": "FREQ=WEEKLY;BYDAY=WE",
}


def resolve(schema: dict) -> dict:
    while "$ref" in schema:
        node = SPEC
        for part in schema["$ref"].removeprefix("#/").split("/"):
            node = node[part]
        schema = node
    return schema


JSON_TYPES = {
    "object": dict,
    "array": list,
    "string": str,
    "boolean": bool,
    "null": type(None),
}


def errors(value, schema: dict, at: str = "$") -> list[str]:
    """Where value breaks schema, for the JSON Schema subset the spec uses.
    Objects must have exactly the properties the schema lists, so a column the
    spec doesn't know about fails too."""
    schema = resolve(schema)
    found = []
    if "allOf" in schema:
        merged = {"type": "object", "properties": {}, "required": []}
        for part in map(resolve, schema["allOf"]):
            if "properties" not in part:
                found += errors(value, part, at)
                continue
            merged["properties"].update(part["properties"])
            merged["required"] += part.get("required", [])
        if merged["properties"]:
            found += errors(value, merged, at)
    if "anyOf" in schema and all(errors(value, s, at) for s in schema["anyOf"]):
        found.append(f"{at}: {value!r} matches no anyOf branch")
    if "const" in schema and value != schema["const"]:
        found.append(f"{at}: {value!r} != {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        found.append(f"{at}: {value!r} not in {schema['enum']}")
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(isinstance(value, JSON_TYPES[t]) for t in types):
            return [*found, f"{at}: {value!r} is not {types}"]
    if isinstance(value, str) and "pattern" in schema and not re.search(schema["pattern"], value):
        found.append(f"{at}: {value!r} doesn't match {schema['pattern']}")
    if isinstance(value, list) and "items" in schema:
        for i, item in enumerate(value):
            found += errors(item, schema["items"], f"{at}[{i}]")
    if isinstance(value, dict) and "properties" in schema:
        props = schema["properties"]
        found += [f"{at}: missing {k}" for k in schema.get("required", []) if k not in value]
        found += [f"{at}: undocumented {k}" for k in value if k not in props]
        for k, v in value.items():
            if k in props:
                found += errors(v, props[k], f"{at}.{k}")
    return found


def operations():
    for path, item in SPEC["paths"].items():
        for method, op in item.items():
            if method in METHODS:
                yield path, method, op


class SpecTest(unittest.TestCase):
    def test_refs_resolve(self):
        refs = re.findall(r'"\$ref": "([^"]+)"', json.dumps(SPEC))
        for ref in set(refs):
            with self.subTest(ref=ref):
                resolve({"$ref": ref})

    def test_operations_are_documented(self):
        ids = [op["operationId"] for _, _, op in operations()]
        self.assertEqual(len(ids), len(set(ids)))
        for path, method, op in operations():
            with self.subTest(op=f"{method} {path}"):
                codes = op["responses"].keys()
                self.assertTrue(any(c.startswith("2") for c in codes))
                if op.get("security") != []:
                    self.assertIn("401", codes)
                if method in ("put", "post"):
                    self.assertIn("400", codes)
                if method == "post":
                    params = [p.get("$ref") for p in op.get("parameters", [])]
                    self.assertIn("#/components/parameters/NexusClient", params)


class RoutesMatchSpecTest(AppTestCase):
    def routes(self, blueprint: str, prefix: str) -> set:
        """(spec-style path, method) of every route the blueprint serves under prefix."""
        found = set()
        for rule in self.app.url_map.iter_rules():
            if rule.endpoint.startswith(f"{blueprint}."):
                self.assertTrue(rule.rule.startswith(prefix + "/"), rule.rule)
                path = re.sub(r"<(?:\w+:)?(\w+)>", r"{\1}", rule.rule.removeprefix(prefix))
                found |= {(path, m.lower()) for m in rule.methods - {"HEAD", "OPTIONS"}}
        return found

    def test_spec_lists_every_v1_route(self):
        documented = {(path, method) for path, method, _ in operations()}
        self.assertEqual(self.routes("v1", "/api/v1"), documented)

    def test_api_alias_serves_the_same_routes(self):
        self.assertEqual(self.routes("legacy", "/api"), self.routes("v1", "/api/v1"))

    def test_alias_answers_like_v1(self):
        task = self.request("POST", "/api/tasks", {"title": "T"}, status=201)
        self.assertEqual(self.request("GET", f"/api/v1/tasks/{task['id']}"), task)
        self.assertEqual(self.request("GET", "/api/tasks"), self.request("GET", "/api/v1/tasks"))


def spec_path(path: str) -> str:
    """The spec's template for a concrete path ("/tasks/abc?x=1" -> "/tasks/{task_id}")."""
    path = path.split("?")[0]
    for template in SPEC["paths"]:
        if re.fullmatch(re.sub(r"\{\w+\}", "[^/]+", template), path):
            return template
    raise AssertionError(f"no spec path for {path}")


class ResponsesMatchSpecTest(AppTestCase):
    def check(self, method, path, body=None, status=200, **kw):
        res = self.request(method, f"/api/v1{path}", body, status=status, **kw)
        op = SPEC["paths"][spec_path(path)][method.lower()]
        response = resolve(op["responses"][str(status)])
        self.assertEqual(errors(res, response["content"]["application/json"]["schema"]), [], f"{method} {path}")
        return res

    def test_tasks_projects_features(self):
        p = self.check("POST", "/projects", {"title": "P", "type": "coding"}, 201, headers={"X-Nexus-Client": "agent"})
        pid = p["id"]
        self.check("GET", "/projects")
        self.check("PUT", f"/projects/{pid}", {"notes": "n", "status": ""})
        self.check("GET", f"/projects/{pid}")
        self.check("GET", f"/projects/{pid}/notes")
        f = self.check("POST", f"/projects/{pid}/features", {"name": "F"}, 201)
        self.check("GET", f"/projects/{pid}/features")
        self.check("PUT", f"/features/{f['id']}", {"notes": "x"})
        self.check("GET", f"/features/{f['id']}")
        t = self.check("POST", "/tasks", {"title": "T", "project_id": pid, "feature_id": f["id"]}, 201)
        self.check("PUT", f"/tasks/{t['id']}", {"status": "complete"})
        self.check("GET", "/tasks?status=complete,todo")
        self.check("GET", f"/tasks/{t['id']}")
        self.check("DELETE", f"/tasks/{t['id']}")
        self.check("DELETE", f"/features/{f['id']}")
        self.check("DELETE", f"/projects/{pid}")

    def test_events(self):
        window = "/events?start=2026-09-28T00:00:00Z&end=2026-10-20T00:00:00Z"
        m = self.check("POST", "/events", WEEKLY, 201)
        self.check("GET", window)
        self.check("PUT", f"/events/{m['id']}/occurrences/2026-10-07T16:00:00Z", {"scope": "this", "title": "X"})
        self.check("GET", window)  # now with an override
        self.check("DELETE", f"/events/{m['id']}/occurrences/2026-10-14T16:00:00Z?scope=this")
        plain = self.check("POST", "/events", {**WEEKLY, "rrule": None, "all_day": None}, 201)
        self.check("PUT", f"/events/{plain['id']}", {"category": "work"})
        self.check("DELETE", f"/events/{plain['id']}")

    def test_errors(self):
        self.check("GET", "/tasks/00000000-0000-0000-0000-000000000000", status=404)
        self.check("POST", "/tasks", {"title": " "}, 400)
        self.check("GET", "/health")


if __name__ == "__main__":
    unittest.main()
