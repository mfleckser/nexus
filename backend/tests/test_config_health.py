"""Startup config, host checking, the API token gate and the health endpoint."""

import os
import unittest
from unittest import mock

from app_case import AppTestCase

from app import config, create_app


class HealthTest(AppTestCase):
    def test_connected(self):
        res = self.client.get("/api/health")
        self.assertEqual((res.status_code, res.get_json()), (200, {"status": "ok", "db": "connected"}))
        self.assertEqual(self.db.queries, ["tasks"])

    def test_db_error_is_503(self):
        self.quiet_errors()
        self.db.fail_on = "select"
        res = self.client.get("/api/health")
        self.assertEqual((res.status_code, res.get_json()), (503, {"status": "error", "db": "error"}))


class ApiTokenTest(AppTestCase):
    def setUp(self):
        super().setUp()
        del self.client.environ_base["HTTP_AUTHORIZATION"]

    def assert_unauthorized(self, res):
        self.assertEqual((res.status_code, res.get_json()), (401, {"error": "missing or invalid API token"}))

    def test_missing_or_wrong_token_rejected(self):
        token = os.environ["NEXUS_API_TOKEN"]
        for headers in (
            {},
            {"Authorization": "Bearer nope"},
            {"Authorization": token},
            {"Authorization": f"Bearer {token}x"},
        ):
            with self.subTest(headers=headers):
                self.assert_unauthorized(self.client.get("/api/tasks", headers=headers))
        self.assert_unauthorized(self.client.get("/api/nope"))  # unknown routes too
        self.assertEqual(self.db.queries, [])

    def test_right_token_allowed(self):
        res = self.client.get("/api/tasks", headers={"Authorization": f"Bearer {os.environ['NEXUS_API_TOKEN']}"})
        self.assertEqual(res.status_code, 200)

    def test_health_is_public(self):
        self.assertEqual(self.client.get("/api/health").status_code, 200)


class TrustedHostsTest(AppTestCase):
    def test_local_hosts_allowed(self):
        for host in ("127.0.0.1:5000", "localhost:5000", "127.0.0.1"):
            with self.subTest(host=host):
                self.assertEqual(self.client.get("/api/tasks", headers={"Host": host}).status_code, 200)

    def test_other_hosts_rejected(self):
        res = self.client.get("/api/tasks", headers={"Host": "evil.example:5000"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("error", res.get_json())

    def test_extra_hosts_from_env(self):
        with mock.patch.dict(os.environ, {"NEXUS_TRUSTED_HOSTS": " pi.tail-1.ts.net, ,other "}):
            self.assertEqual(config.env_list("NEXUS_TRUSTED_HOSTS"), ["pi.tail-1.ts.net", "other"])


class ConfigTest(unittest.TestCase):
    def test_missing_supabase_credentials(self):
        with mock.patch.dict(os.environ, {"SUPABASE_URL": "http://x"}, clear=True):
            with self.assertRaisesRegex(config.ConfigError, "SUPABASE_KEY") as ctx:
                config.supabase_credentials()
        self.assertNotIn("SUPABASE_URL", str(ctx.exception))
        with mock.patch.dict(os.environ, {"SUPABASE_URL": "u", "SUPABASE_KEY": "k"}, clear=True):
            self.assertEqual(config.supabase_credentials(), ("u", "k"))

    def test_missing_api_token(self):
        for value in ("", "  "):
            with self.subTest(value=value), mock.patch.dict(os.environ, {"NEXUS_API_TOKEN": value}):
                with self.assertRaisesRegex(config.ConfigError, "NEXUS_API_TOKEN"):
                    create_app()

    def test_port(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(config.port(), 5000)
        with mock.patch.dict(os.environ, {"NEXUS_PORT": "8040"}):
            self.assertEqual(config.port(), 8040)
        with mock.patch.dict(os.environ, {"NEXUS_PORT": "abc"}):
            with self.assertRaisesRegex(config.ConfigError, "NEXUS_PORT"):
                config.port()

    def test_env_flag(self):
        for value, expected in [("1", True), ("true", True), ("ON", True), ("0", False), ("", False)]:
            with self.subTest(value=value), mock.patch.dict(os.environ, {"NEXUS_DEBUG": value}):
                self.assertIs(config.env_flag("NEXUS_DEBUG"), expected)
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertFalse(config.env_flag("NEXUS_DEBUG"))


if __name__ == "__main__":
    unittest.main()
