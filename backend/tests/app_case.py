"""Shared base for API tests: a fresh app + Flask test client wired to an
in-memory FakeSupabase (the real client is never contacted)."""

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "http://localhost:1")  # never contacted; supabase is faked
os.environ.setdefault("SUPABASE_KEY", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fake_supabase import FakeSupabase  # noqa: E402

from app import create_app  # noqa: E402
from app.api import health  # noqa: E402
from app.services import event_service, project_service, task_service  # noqa: E402

PATCHED_MODULES = (event_service, task_service, project_service, health)


class AppTestCase(unittest.TestCase):
    def setUp(self):
        self.db = FakeSupabase()
        for module in PATCHED_MODULES:
            if hasattr(module, "supabase"):
                patcher = mock.patch.object(module, "supabase", self.db)
                patcher.start()
                self.addCleanup(patcher.stop)
        self.app = create_app()
        self.client = self.app.test_client()

    def quiet_errors(self):
        """Silence the logged traceback of an expected 500."""
        self.app.logger.disabled = True
        self.addCleanup(setattr, self.app.logger, "disabled", False)

    def request(self, method, path, json=None, status=200, **kw):
        res = self.client.open(path, method=method, json=json, **kw)
        self.assertEqual(res.status_code, status, res.get_data(as_text=True))
        return res.get_json()
