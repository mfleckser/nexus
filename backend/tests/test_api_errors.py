"""Every error is a JSON {"error": ...} body with the right status code."""

import unittest
from unittest import mock

from app_case import AppTestCase
from supabase import PostgrestAPIError

MISSING = "00000000-0000-0000-0000-000000000000"


class ErrorHandlingTest(AppTestCase):
    def assert_error(self, res, status, message=None):
        self.assertEqual(res.status_code, status, res.get_data(as_text=True))
        self.assertTrue(res.is_json, res.get_data(as_text=True))
        body = res.get_json()
        self.assertEqual(set(body), {"error"})
        if message is not None:
            self.assertEqual(body["error"], message)

    def test_unknown_route_and_method_are_json(self):
        self.assert_error(self.client.get("/api/nope"), 404)
        self.assert_error(self.client.patch("/api/tasks"), 405)

    def test_bad_bodies_are_400(self):
        for path in ("/api/tasks", "/api/projects", "/api/events", f"/api/projects/{MISSING}/features"):
            with self.subTest(path=path):
                bad_json = self.client.post(path, data="{nope", content_type="application/json")
                self.assert_error(bad_json, 400, "request body must be a JSON object")
                self.assert_error(self.client.post(path, json=None), 400)
                self.assert_error(self.client.post(path, json=["title"]), 400)
                self.assert_error(self.client.post(path, data="title=x"), 400)  # not JSON at all

    def test_missing_ids_are_404(self):
        cases = [
            ("PUT", f"/api/tasks/{MISSING}", {"title": "x"}),
            ("DELETE", f"/api/tasks/{MISSING}", None),
            ("PUT", f"/api/projects/{MISSING}", {"title": "x"}),
            ("DELETE", f"/api/projects/{MISSING}", None),
            ("GET", f"/api/projects/{MISSING}/notes", None),
            ("DELETE", f"/api/features/{MISSING}", None),
            ("PUT", f"/api/events/{MISSING}", {"title": "x"}),
            ("DELETE", f"/api/events/{MISSING}", None),
        ]
        for method, path, body in cases:
            with self.subTest(method=method, path=path):
                self.assert_error(self.client.open(path, method=method, json=body), 404)

    def test_invalid_uuid_is_400(self):
        self.assert_error(self.client.delete("/api/tasks/not-a-uuid"), 400)

    def test_constraint_violation_is_400(self):
        err = PostgrestAPIError({"code": "23505", "message": "duplicate key value"})
        with mock.patch("app.api.tasks.create_task", side_effect=err):
            self.assert_error(self.client.post("/api/tasks", json={"title": "x"}), 400, "duplicate key value")

    def test_other_db_error_is_500(self):
        self.quiet_errors()
        err = PostgrestAPIError({"code": "PGRST301", "message": "JWT expired"})
        with mock.patch("app.api.tasks.get_all_tasks", side_effect=err):
            self.assert_error(self.client.get("/api/tasks"), 500, "Database error")

    def test_unexpected_exception_is_500_without_details(self):
        self.quiet_errors()
        with mock.patch("app.api.tasks.get_all_tasks", side_effect=KeyError("secret")):
            self.assert_error(self.client.get("/api/tasks"), 500, "Internal server error")
        # A stray ValueError is a bug, not bad input.
        with mock.patch("app.api.tasks.get_all_tasks", side_effect=ValueError("internal")):
            self.assert_error(self.client.get("/api/tasks"), 500, "Internal server error")

    def test_unexpected_exception_is_logged(self):
        with mock.patch("app.api.tasks.get_all_tasks", side_effect=RuntimeError("boom")):
            with self.assertLogs(self.app.logger, level="ERROR") as logs:
                self.client.get("/api/tasks")
        self.assertIn("RuntimeError: boom", "\n".join(logs.output))


if __name__ == "__main__":
    unittest.main()
