"""Cached reads and their invalidation, including across entities via FK
on-delete actions."""

import unittest

from app_case import AppTestCase


class CacheTest(AppTestCase):
    def get(self, path):
        return self.request("GET", path)

    def queries_for(self, path):
        """How many DB queries a GET makes (0 = served from cache)."""
        before = len(self.db.queries)
        self.get(path)
        return len(self.db.queries) - before

    def project(self):
        return self.request("POST", "/api/projects", {"title": "P", "description": "d"}, status=201)

    def task(self, **body):
        return self.request("POST", "/api/tasks", {"title": "T", **body}, status=201)

    def test_reads_are_cached(self):
        p = self.project()
        for path in (
            "/api/tasks",
            "/api/projects",
            f"/api/projects/{p['id']}/notes",
            f"/api/projects/{p['id']}/features",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.queries_for(path), 1)
                self.assertEqual(self.queries_for(path), 0)

    def test_task_writes_invalidate_tasks(self):
        self.get("/api/tasks")
        t = self.task()
        self.assertEqual([x["id"] for x in self.get("/api/tasks")], [t["id"]])
        self.request("PUT", f"/api/tasks/{t['id']}", {"title": "U"})
        self.assertEqual(self.get("/api/tasks")[0]["title"], "U")
        self.request("DELETE", f"/api/tasks/{t['id']}")
        self.assertEqual(self.get("/api/tasks"), [])

    def test_project_writes_invalidate_projects_and_notes(self):
        self.get("/api/projects")
        p = self.project()
        self.assertEqual(len(self.get("/api/projects")), 1)
        self.get(f"/api/projects/{p['id']}/notes")
        self.request("PUT", f"/api/projects/{p['id']}", {"notes": "n", "title": "Q"})
        self.assertEqual(self.get(f"/api/projects/{p['id']}/notes"), {"notes": "n"})
        self.assertEqual(self.get("/api/projects")[0]["title"], "Q")
        self.request("DELETE", f"/api/projects/{p['id']}")
        self.assertEqual(self.get("/api/projects"), [])
        self.request("GET", f"/api/projects/{p['id']}/notes", status=404)

    def test_feature_writes_invalidate_features(self):
        p = self.project()
        path = f"/api/projects/{p['id']}/features"
        self.get(path)
        f = self.request("POST", path, {"name": "F"}, status=201)
        self.assertEqual([x["id"] for x in self.get(path)], [f["id"]])
        self.request("DELETE", f"/api/features/{f['id']}")
        self.assertEqual(self.get(path), [])

    def test_project_delete_clears_tasks_and_features(self):
        p = self.project()
        f = self.request("POST", f"/api/projects/{p['id']}/features", {"name": "F"}, status=201)
        t = self.task(project_id=p["id"], feature_id=f["id"])
        self.assertEqual(self.get("/api/tasks")[0]["project_id"], p["id"])  # now cached
        self.get(f"/api/projects/{p['id']}/features")
        self.request("DELETE", f"/api/projects/{p['id']}")
        task = self.get("/api/tasks")[0]
        self.assertEqual((task["id"], task["project_id"], task["feature_id"]), (t["id"], None, None))
        self.assertEqual(self.get(f"/api/projects/{p['id']}/features"), [])

    def test_feature_delete_clears_tasks(self):
        p = self.project()
        f = self.request("POST", f"/api/projects/{p['id']}/features", {"name": "F"}, status=201)
        self.task(project_id=p["id"], feature_id=f["id"])
        self.assertEqual(self.get("/api/tasks")[0]["feature_id"], f["id"])
        self.request("DELETE", f"/api/features/{f['id']}")
        self.assertIsNone(self.get("/api/tasks")[0]["feature_id"])

    def test_event_delete_clears_tasks(self):
        body = {"title": "E", "start_at": "2026-10-01T16:00:00Z", "end_at": "2026-10-01T17:00:00Z"}
        ev = self.request("POST", "/api/events", body, status=201)
        # The API doesn't link tasks to events yet; link one directly.
        self.db.table("tasks").insert({"title": "T", "event_id": ev["id"]}).execute()
        self.assertEqual(self.get("/api/tasks")[0]["event_id"], ev["id"])
        self.request("DELETE", f"/api/events/{ev['id']}")
        self.assertIsNone(self.get("/api/tasks")[0]["event_id"])


if __name__ == "__main__":
    unittest.main()
