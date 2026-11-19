"""Cached reads and their invalidation, including across entities via FK
on-delete actions."""

import unittest
from unittest import mock

from app_case import AppTestCase

from app.services import event_service as es


class CacheTest(AppTestCase):
    def get(self, path):
        return self.request("GET", path)

    def queries_for(self, path):
        """How many DB queries a GET makes (0 = served from cache)."""
        before = len(self.db.queries)
        self.get(path)
        return len(self.db.queries) - before

    def project(self):
        return self.request("POST", "/api/v1/projects", {"title": "P", "description": "d"}, status=201)

    def task(self, **body):
        return self.request("POST", "/api/v1/tasks", {"title": "T", **body}, status=201)

    def test_load_racing_an_invalidate_is_not_cached(self):
        from app.extensions.cache import TASKS, cache, get_or_load, invalidate

        with self.app.app_context():

            def loader():
                invalidate(TASKS)  # a write lands while this read is in flight
                return ["stale"]

            self.assertEqual(get_or_load(TASKS, loader), ["stale"])
            self.assertIsNone(cache.get(TASKS))

    def test_event_window_read_racing_a_write_is_not_cached(self):
        body = {"title": "Old", "start_at": "2026-10-01T16:00:00Z", "end_at": "2026-10-01T17:00:00Z"}
        ev = self.request("POST", "/api/v1/events", body, status=201)
        path = "/api/v1/events?start=2026-10-01T00:00:00Z&end=2026-10-02T00:00:00Z"
        load = es._load_events

        def racing(start, end):
            rows = load(start, end)  # the read finishes its queries...
            es.update_event(ev["id"], {"title": "New"})  # ...then a write commits and invalidates
            return rows

        with mock.patch.object(es, "_load_events", side_effect=racing):
            self.assertEqual([e["title"] for e in self.get(path)], ["Old"])
        self.assertEqual([e["title"] for e in self.get(path)], ["New"])
        self.assertEqual(self.queries_for(path), 0)  # and that one is cached

    def test_invalidating_a_family_deletes_its_windows(self):
        from app.extensions.cache import EVENTS, cache, family_key, invalidate

        path = "/api/v1/events?start=2026-10-01T00:00:00Z&end=2026-10-02T00:00:00Z"
        with self.app.app_context():
            self.get(path)
            key = family_key(EVENTS, "2026-10-01T00:00:00+00:00", "2026-10-02T00:00:00+00:00")
            self.assertIsNotNone(cache.get(key))
            invalidate(EVENTS)
            self.assertIsNone(cache.get(key))

    def test_family_load_racing_an_invalidate_is_not_cached(self):
        from app.extensions.cache import EVENTS, cache, family_key, get_or_load, invalidate

        with self.app.app_context():
            key = family_key(EVENTS, "a", "b")

            def loader():
                invalidate(EVENTS)  # a write lands while this read is in flight
                return ["stale"]

            self.assertEqual(get_or_load(key, loader, EVENTS), ["stale"])
            self.assertIsNone(cache.get(key))
            self.assertNotEqual(family_key(EVENTS, "a", "b"), key)

    def test_reads_are_cached(self):
        p = self.project()
        for path in (
            "/api/v1/tasks",
            "/api/v1/projects",
            f"/api/v1/projects/{p['id']}/notes",
            f"/api/v1/projects/{p['id']}/features",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.queries_for(path), 1)
                self.assertEqual(self.queries_for(path), 0)

    def test_task_writes_invalidate_tasks(self):
        self.get("/api/v1/tasks")
        t = self.task()
        self.assertEqual([x["id"] for x in self.get("/api/v1/tasks")], [t["id"]])
        self.request("PUT", f"/api/v1/tasks/{t['id']}", {"title": "U"})
        self.assertEqual(self.get("/api/v1/tasks")[0]["title"], "U")
        self.request("DELETE", f"/api/v1/tasks/{t['id']}")
        self.assertEqual(self.get("/api/v1/tasks"), [])

    def test_filtered_task_lists_share_the_cache(self):
        self.task(title="a")
        self.get("/api/v1/tasks")
        self.assertEqual(self.queries_for("/api/v1/tasks?status=todo"), 0)
        t = self.task(title="b")
        self.request("PUT", f"/api/v1/tasks/{t['id']}", {"status": "blocked"})
        self.assertEqual([x["title"] for x in self.get("/api/v1/tasks?status=blocked")], ["b"])

    def test_project_writes_invalidate_projects_and_notes(self):
        self.get("/api/v1/projects")
        p = self.project()
        self.assertEqual(len(self.get("/api/v1/projects")), 1)
        self.get(f"/api/v1/projects/{p['id']}/notes")
        self.request("PUT", f"/api/v1/projects/{p['id']}", {"notes": "n", "title": "Q"})
        self.assertEqual(self.get(f"/api/v1/projects/{p['id']}/notes"), {"notes": "n"})
        self.assertEqual(self.get("/api/v1/projects")[0]["title"], "Q")
        self.request("DELETE", f"/api/v1/projects/{p['id']}")
        self.assertEqual(self.get("/api/v1/projects"), [])
        self.request("GET", f"/api/v1/projects/{p['id']}/notes", status=404)

    def test_feature_writes_invalidate_features(self):
        p = self.project()
        path = f"/api/v1/projects/{p['id']}/features"
        self.get(path)
        f = self.request("POST", path, {"name": "F"}, status=201)
        self.assertEqual([x["id"] for x in self.get(path)], [f["id"]])
        self.request("PUT", f"/api/v1/features/{f['id']}", {"name": "G"})
        self.assertEqual([x["name"] for x in self.get(path)], ["G"])
        self.request("DELETE", f"/api/v1/features/{f['id']}")
        self.assertEqual(self.get(path), [])

    def test_project_delete_clears_tasks_and_features(self):
        p = self.project()
        f = self.request("POST", f"/api/v1/projects/{p['id']}/features", {"name": "F"}, status=201)
        t = self.task(project_id=p["id"], feature_id=f["id"])
        self.assertEqual(self.get("/api/v1/tasks")[0]["project_id"], p["id"])  # now cached
        self.get(f"/api/v1/projects/{p['id']}/features")
        self.request("DELETE", f"/api/v1/projects/{p['id']}")
        task = self.get("/api/v1/tasks")[0]
        self.assertEqual((task["id"], task["project_id"], task["feature_id"]), (t["id"], None, None))
        self.assertEqual(self.get(f"/api/v1/projects/{p['id']}/features"), [])

    def test_feature_delete_clears_tasks(self):
        p = self.project()
        f = self.request("POST", f"/api/v1/projects/{p['id']}/features", {"name": "F"}, status=201)
        self.task(project_id=p["id"], feature_id=f["id"])
        self.assertEqual(self.get("/api/v1/tasks")[0]["feature_id"], f["id"])
        self.request("DELETE", f"/api/v1/features/{f['id']}")
        self.assertIsNone(self.get("/api/v1/tasks")[0]["feature_id"])

    def test_event_delete_clears_tasks(self):
        body = {"title": "E", "start_at": "2026-10-01T16:00:00Z", "end_at": "2026-10-01T17:00:00Z"}
        ev = self.request("POST", "/api/v1/events", body, status=201)
        self.task(event_id=ev["id"])
        self.assertEqual(self.get("/api/v1/tasks")[0]["event_id"], ev["id"])
        self.request("DELETE", f"/api/v1/events/{ev['id']}")
        self.assertIsNone(self.get("/api/v1/tasks")[0]["event_id"])


if __name__ == "__main__":
    unittest.main()
