"""Task API against the fake Supabase."""

import unittest
from datetime import UTC, datetime, timedelta

from app_case import AppTestCase


class TasksTest(AppTestCase):
    def create(self, **body):
        body.setdefault("title", "Write tests")
        return self.request("POST", "/api/tasks", body, status=201)

    def put(self, task_id, body, status=200):
        return self.request("PUT", f"/api/tasks/{task_id}", body, status=status)

    def test_crud_shapes(self):
        t = self.create(description="d", due_at="2026-10-02T17:00:00Z")
        self.assertEqual((t["title"], t["status"], t["due_at"]), ("Write tests", "todo", "2026-10-02T17:00:00+00:00"))
        self.assertEqual(self.request("GET", "/api/tasks"), [t])
        updated = self.put(t["id"], {"title": "Renamed", "status": "active"})
        self.assertEqual((updated["title"], updated["status"]), ("Renamed", "active"))
        self.assertEqual(self.request("DELETE", f"/api/tasks/{t['id']}")["id"], t["id"])
        self.assertEqual(self.request("GET", "/api/tasks"), [])

    def test_list_is_ordered_by_creation(self):
        ids = [self.create(title=str(i))["id"] for i in range(5)]
        # Shuffle storage order; the API must still return oldest first.
        self.db.tables["tasks"].reverse()
        self.assertEqual([t["id"] for t in self.request("GET", "/api/tasks")], ids)

    def test_create_validation(self):
        for body in [
            {},
            {"description": "no title"},
            {"title": None},
            {"title": "   "},
            {"title": 5},
            {"title": "x", "due_at": "tomorrow"},
            {"title": "x", "description": ["a"]},
        ]:
            with self.subTest(body=body):
                self.request("POST", "/api/tasks", body, status=400)
        self.assertEqual(self.db.tables["tasks"], [])

    def test_update_validation(self):
        t = self.create()
        for body in [
            {"status": "done"},
            {"status": None},
            {"title": None},
            {"title": ""},
            {"due_at": 12},
        ]:
            with self.subTest(body=body):
                self.put(t["id"], body, status=400)
        for status in ("todo", "active", "complete", "cancelled"):
            self.assertEqual(self.put(t["id"], {"status": status})["status"], status)
        self.assertIsNone(self.put(t["id"], {"due_at": None})["due_at"])

    def test_completed_at_tracks_transitions(self):
        t = self.create()
        self.assertIsNone(t["completed_at"])

        done = self.put(t["id"], {"status": "complete"})
        stamp = datetime.fromisoformat(done["completed_at"])
        self.assertIsNotNone(stamp.tzinfo)
        self.assertLess(abs(datetime.now(UTC) - stamp), timedelta(minutes=1))

        # Re-saving a complete task (or editing other fields) keeps the original stamp.
        self.assertEqual(self.put(t["id"], {"status": "complete", "title": "x"})["completed_at"], done["completed_at"])
        self.assertEqual(self.put(t["id"], {"title": "y"})["completed_at"], done["completed_at"])

        for status in ("todo", "active", "cancelled"):
            self.put(t["id"], {"status": "complete"})
            self.assertIsNone(self.put(t["id"], {"status": status})["completed_at"])

    def test_update_without_known_fields_returns_current_row(self):
        t = self.create()
        self.assertEqual(self.put(t["id"], {}), t)
        self.assertEqual(self.put(t["id"], {"bogus": 1, "completed_at": "2026-01-01T00:00:00Z"}), t)
        self.put("00000000-0000-0000-0000-000000000000", {}, status=404)


if __name__ == "__main__":
    unittest.main()
