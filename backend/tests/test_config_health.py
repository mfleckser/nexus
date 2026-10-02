"""Startup config, host checking and the health endpoint."""

import os
import unittest
from unittest import mock

from app_case import AppTestCase

from app import config


class HealthTest(AppTestCase):
    def test_connected(self):
        res = self.client.get("/api/health")
        self.assertEqual((res.status_code, res.get_json()), (200, {"status": "ok", "db": "connected"}))
        self.assertEqual(self.db.queries, ["tasks"])

    def test_db_error_is_503(self):
        self.quiet_errors()
        self.db.fail_on = "select"
        res = self.client.get("/api/health")
        self.assertEqual((res.status_code, res.get_json()), (503, {"status": "ok", "db": "error"}))


class TrustedHostsTest(AppTestCase):
    def test_local_hosts_allowed(self):
        for host in ("127.0.0.1:5000", "localhost:5000", "127.0.0.1"):
            with self.subTest(host=host):
                self.assertEqual(self.client.get("/api/tasks", headers={"Host": host}).status_code, 200)

    def test_other_hosts_rejected(self):
        res = self.client.get("/api/tasks", headers={"Host": "evil.example:5000"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("error", res.get_json())


class ConfigTest(unittest.TestCase):
    def test_missing_supabase_credentials(self):
        with mock.patch.dict(os.environ, {"SUPABASE_URL": "http://x"}, clear=True):
            with self.assertRaisesRegex(config.ConfigError, "SUPABASE_KEY") as ctx:
                config.supabase_credentials()
        self.assertNotIn("SUPABASE_URL", str(ctx.exception))
        with mock.patch.dict(os.environ, {"SUPABASE_URL": "u", "SUPABASE_KEY": "k"}, clear=True):
            self.assertEqual(config.supabase_credentials(), ("u", "k"))

    def test_env_flag(self):
        for value, expected in [("1", True), ("true", True), ("ON", True), ("0", False), ("", False)]:
            with self.subTest(value=value), mock.patch.dict(os.environ, {"NEXUS_DEBUG": value}):
                self.assertIs(config.env_flag("NEXUS_DEBUG"), expected)
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(config.env_flag("NEXUS_DEBUG"))


if __name__ == "__main__":
    unittest.main()
