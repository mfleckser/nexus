"""created_via: new rows record the X-Nexus-Client that created them."""

import unittest

from app_case import AppTestCase

WEEKLY = {
    "title": "Standup",
    "start_at": "2026-09-30T16:00:00Z",
    "end_at": "2026-09-30T17:00:00Z",
    "timezone": "America/Los_Angeles",
    "rrule": "FREQ=WEEKLY;BYDAY=WE",
}


class CreatedViaTest(AppTestCase):
    def post(self, path, body, client=None):
        headers = {"X-Nexus-Client": client} if client else {}
        return self.request("POST", path, body, status=201, headers=headers)

    def test_creates_stamp_the_client(self):
        project = self.post("/api/v1/projects", {"title": "P"}, "desktop")
        feature = self.post(f"/api/v1/projects/{project['id']}/features", {"name": "F"}, "agent")
        task = self.post("/api/v1/tasks", {"title": "T"}, "mobile")
        event = self.post("/api/v1/events", {**WEEKLY, "rrule": None}, "agent")
        self.assertEqual(
            [r["created_via"] for r in (project, feature, task, event)], ["desktop", "agent", "mobile", "agent"]
        )

    def test_missing_or_unknown_client_stores_null(self):
        for client in (None, "web", "Desktop"):
            with self.subTest(client=client):
                self.assertIsNone(self.post("/api/v1/tasks", {"title": "T"}, client)["created_via"])

    def test_body_cannot_set_it(self):
        task = self.post("/api/v1/tasks", {"title": "T", "created_via": "mobile"}, "desktop")
        self.assertEqual(task["created_via"], "desktop")
        updated = self.request("PUT", f"/api/v1/tasks/{task['id']}", {"created_via": "agent", "title": "U"})
        self.assertEqual(updated["created_via"], "desktop")

    def test_updates_keep_it(self):
        project = self.post("/api/v1/projects", {"title": "P"}, "desktop")
        res = self.request(
            "PUT", f"/api/v1/projects/{project['id']}", {"title": "Q"}, headers={"X-Nexus-Client": "agent"}
        )
        self.assertEqual(res["created_via"], "desktop")

    def test_recurring_edits_copy_the_masters(self):
        master = self.post("/api/v1/events", WEEKLY, "desktop")
        agent = {"X-Nexus-Client": "agent"}
        override = self.request(
            "PUT",
            f"/api/v1/events/{master['id']}/occurrences/2026-10-07T16:00:00Z",
            {"scope": "this", "title": "Moved"},
            headers=agent,
        )
        split = self.request(
            "PUT",
            f"/api/v1/events/{master['id']}/occurrences/2026-10-14T16:00:00Z",
            {"scope": "following", "title": "Later"},
            headers=agent,
        )
        self.assertNotEqual(split["id"], master["id"])
        self.assertEqual([override["created_via"], split["created_via"]], ["desktop", "desktop"])


if __name__ == "__main__":
    unittest.main()
