"""Project / feature API against the fake Supabase."""

import unittest

from app_case import AppTestCase


class ProjectsTest(AppTestCase):
    def create(self, **body):
        body.setdefault("title", "Nexus")
        body.setdefault("description", "Life system")
        return self.request("POST", "/api/projects", body, status=201)

    def put(self, project_id, body, status=200):
        return self.request("PUT", f"/api/projects/{project_id}", body, status=status)

    def add_feature(self, project_id, name="Calendar", status=201):
        return self.request("POST", f"/api/projects/{project_id}/features", {"name": name}, status=status)

    def test_crud_shapes(self):
        p = self.create(type="coding")
        self.assertEqual((p["title"], p["type"], p["status"]), ("Nexus", "coding", "active"))
        listed = self.request("GET", "/api/projects")
        self.assertEqual([x["id"] for x in listed], [p["id"]])
        self.assertNotIn("notes", listed[0])
        self.put(p["id"], {"notes": "hello"})
        self.assertEqual(self.request("GET", f"/api/projects/{p['id']}/notes"), {"notes": "hello"})
        f = self.add_feature(p["id"])
        self.assertEqual(self.request("GET", f"/api/projects/{p['id']}/features")[0]["name"], "Calendar")
        self.assertEqual(self.request("DELETE", f"/api/features/{f['id']}")["id"], f["id"])
        self.assertEqual(self.request("DELETE", f"/api/projects/{p['id']}")["id"], p["id"])

    def test_create_validation(self):
        for body in [
            {"description": "no title"},
            {"title": None, "description": "d"},
            {"title": "  ", "description": "d"},
            {"title": "x", "description": None},
            {"title": "x", "description": "d", "type": "chores"},
        ]:
            with self.subTest(body=body):
                self.request("POST", "/api/projects", body, status=400)
        self.assertEqual(self.db.tables["projects"], [])

    def test_create_defaults_and_empty_type(self):
        p = self.request("POST", "/api/projects", {"title": "x", "type": ""}, status=201)
        self.assertEqual((p["description"], p["type"]), ("", None))

    def test_update_validation(self):
        p = self.create()
        for body in [
            {"status": "done"},
            {"type": "chores"},
            {"title": None},
            {"description": None},
            {"show_tasks_in_main_view": None},
            {"show_tasks_in_main_view": "yes"},
        ]:
            with self.subTest(body=body):
                self.put(p["id"], body, status=400)
        # What ProjectModal sends for a project with no type / a legacy null status.
        updated = self.put(p["id"], {"title": "y", "description": "", "type": "", "status": "",
                                     "show_tasks_in_main_view": False})  # fmt: skip
        self.assertEqual((updated["type"], updated["status"], updated["show_tasks_in_main_view"]), (None, None, False))
        for status in ("planning", "active", "paused", "complete", "archived"):
            self.assertEqual(self.put(p["id"], {"status": status})["status"], status)

    def test_update_without_known_fields_returns_current_row(self):
        p = self.create()
        self.assertEqual(self.put(p["id"], {"id": "other"})["id"], p["id"])
        self.put("00000000-0000-0000-0000-000000000000", {}, status=404)

    def test_feature_validation(self):
        p = self.create()
        self.request("POST", f"/api/projects/{p['id']}/features", {}, status=400)
        self.add_feature(p["id"], name=" ", status=400)
        self.add_feature(p["id"], name=None, status=400)


if __name__ == "__main__":
    unittest.main()
