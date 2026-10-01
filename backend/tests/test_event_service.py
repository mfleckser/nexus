"""Service/API tests for recurring events against an in-memory fake Supabase."""

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

os.environ["SUPABASE_URL"] = "http://localhost:1"  # never contacted; supabase is faked
os.environ["SUPABASE_KEY"] = "test"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app  # noqa: E402
from app.extensions.cache import cache  # noqa: E402
from app.services import event_service as es  # noqa: E402
from fake_supabase import FakeSupabase  # noqa: E402

LA = "America/Los_Angeles"


class EventServiceTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeSupabase()
        patcher = mock.patch.object(es, "supabase", self.db)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.app = create_app()
        with self.app.app_context():
            cache.clear()
        self.client = self.app.test_client()

    # -- helpers --

    def create(self, **body):
        body.setdefault("title", "Standup")
        res = self.client.post("/api/events", json=body)
        self.assertEqual(res.status_code, 201, res.get_json())
        return res.get_json()

    def weekly_wed(self, **kw):
        # Wednesdays 9:00-10:00 PDT, starting Wed 2026-09-30.
        return self.create(start_at="2026-09-30T16:00:00Z", end_at="2026-09-30T17:00:00Z",
                           timezone=LA, rrule="FREQ=WEEKLY;BYDAY=WE", **kw)

    def events(self, start="2026-09-28T00:00:00Z", end="2026-10-31T00:00:00Z"):
        res = self.client.get(f"/api/events?start={start}&end={end}")
        self.assertEqual(res.status_code, 200)
        return res.get_json()

    def starts(self, **kw):
        return [e["start_at"] for e in self.events(**kw)]

    def put_occ(self, master_id, original_start, body, status=200):
        res = self.client.put(f"/api/events/{master_id}/occurrences/{original_start}", json=body)
        self.assertEqual(res.status_code, status, res.get_json())
        return res.get_json()

    def delete_occ(self, master_id, original_start, scope, status=200):
        res = self.client.delete(f"/api/events/{master_id}/occurrences/{original_start}?scope={scope}")
        self.assertEqual(res.status_code, status, res.get_json())
        return res.get_json()

    def row(self, event_id):
        return next((r for r in self.db.rows if r["id"] == event_id), None)

    # -- fix 1: moving an instance to another day re-aims the rule --

    def test_all_move_to_other_day_shifts_byday(self):
        m = self.weekly_wed()
        self.put_occ(m["id"], "2026-10-14T16:00:00Z",
                     {"scope": "all", "start_at": "2026-10-15T16:00:00Z", "end_at": "2026-10-15T17:00:00Z"})
        master = self.row(m["id"])
        self.assertEqual(master["rrule"], "FREQ=WEEKLY;BYDAY=TH")
        self.assertEqual(master["start_at"], "2026-10-01T16:00:00+00:00")
        self.assertEqual(self.starts()[:3], ["2026-10-01T16:00:00+00:00", "2026-10-08T16:00:00+00:00",
                                             "2026-10-15T16:00:00+00:00"])

    def test_following_move_to_other_day_keeps_moved_instance(self):
        m = self.weekly_wed()
        new = self.put_occ(m["id"], "2026-10-07T16:00:00Z",
                           {"scope": "following", "start_at": "2026-10-08T16:00:00Z",
                            "end_at": "2026-10-08T17:00:00Z"})
        self.assertEqual(new["rrule"], "FREQ=WEEKLY;BYDAY=TH")
        self.assertEqual(new["start_at"], "2026-10-08T16:00:00+00:00")
        self.assertEqual(self.starts()[:3], ["2026-09-30T16:00:00+00:00", "2026-10-08T16:00:00+00:00",
                                             "2026-10-15T16:00:00+00:00"])

    def test_explicit_new_rule_keeps_snap_behaviour(self):
        m = self.weekly_wed()
        new = self.put_occ(m["id"], "2026-10-07T16:00:00Z",
                           {"scope": "following", "start_at": "2026-10-08T16:00:00Z",
                            "end_at": "2026-10-08T17:00:00Z", "rrule": "FREQ=WEEKLY;BYDAY=MO"})
        self.assertEqual(new["rrule"], "FREQ=WEEKLY;BYDAY=MO")
        self.assertEqual(new["start_at"], "2026-10-12T16:00:00+00:00")

    # -- fix 2: edits are measured against the instance's current times --

    def _moved_override_series(self):
        m = self.weekly_wed()
        self.put_occ(m["id"], "2026-10-14T16:00:00Z",
                     {"scope": "this", "start_at": "2026-10-14T18:00:00Z", "end_at": "2026-10-14T20:00:00Z"})
        self.delete_occ(m["id"], "2026-10-21T16:00:00Z", "this")
        return m

    def test_all_title_only_save_of_moved_override(self):
        m = self._moved_override_series()
        # Frontend sends the override's current times back unchanged.
        self.put_occ(m["id"], "2026-10-14T16:00:00Z",
                     {"scope": "all", "title": "Sync",
                      "start_at": "2026-10-14T18:00:00Z", "end_at": "2026-10-14T20:00:00Z"})
        master = self.row(m["id"])
        self.assertEqual((master["start_at"], master["end_at"]),
                         ("2026-09-30T16:00:00+00:00", "2026-09-30T17:00:00+00:00"))
        self.assertEqual(master["exdates"], ["2026-10-21T16:00:00+00:00"])
        evs = self.events()
        self.assertTrue(all(e["title"] == "Sync" for e in evs))
        self.assertIn("2026-10-14T18:00:00+00:00", [e["start_at"] for e in evs])
        self.assertNotIn("2026-10-21T16:00:00+00:00", [e["start_at"] for e in evs])

    def test_all_move_of_moved_override_applies_relative_shift(self):
        m = self._moved_override_series()
        # Override sits at 18:00; nudge it +1h -> series moves +1h (not +3h).
        self.put_occ(m["id"], "2026-10-14T16:00:00Z",
                     {"scope": "all", "start_at": "2026-10-14T19:00:00Z", "end_at": "2026-10-14T21:00:00Z"})
        master = self.row(m["id"])
        self.assertEqual((master["start_at"], master["end_at"]),
                         ("2026-09-30T17:00:00+00:00", "2026-09-30T18:00:00+00:00"))
        self.assertEqual(master["exdates"], [])
        self.assertEqual([r for r in self.db.rows if r["recurring_event_id"]], [])

    def test_following_title_only_save_of_moved_override(self):
        m = self._moved_override_series()
        new = self.put_occ(m["id"], "2026-10-14T16:00:00Z",
                           {"scope": "following", "title": "Later",
                            "start_at": "2026-10-14T18:00:00Z", "end_at": "2026-10-14T20:00:00Z"})
        self.assertEqual(new["start_at"], "2026-10-14T16:00:00+00:00")
        self.assertEqual(new["exdates"], ["2026-10-21T16:00:00+00:00"])
        override = next(r for r in self.db.rows if r["recurring_event_id"])
        self.assertEqual(override["recurring_event_id"], new["id"])
        self.assertEqual((override["start_at"], override["title"]), ("2026-10-14T18:00:00+00:00", "Later"))

    # -- fix 3: pathological rules are rejected --

    def test_rejects_pathological_rules(self):
        for rule in ["FREQ=SECONDLY", "FREQ=DAILY;COUNT=5000", "FREQ=DAILY;UNTIL=21000101T000000Z",
                     "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", "FREQ=DAILY;BYSETPOS=1"]:
            with self.subTest(rule=rule):
                res = self.client.post("/api/events", json={
                    "title": "x", "start_at": "2026-10-01T16:00:00Z", "end_at": "2026-10-01T17:00:00Z",
                    "rrule": rule})
                self.assertEqual(res.status_code, 400)
        self.assertEqual(self.db.rows, [])

    # -- fix 4: plain PUT on a master resets exdates / overrides --

    def test_plain_put_on_master_clears_exceptions(self):
        m = self._moved_override_series()
        res = self.client.put(f"/api/events/{m['id']}", json={
            "start_at": "2026-09-30T17:00:00Z", "end_at": "2026-09-30T18:00:00Z"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.row(m["id"])["exdates"], [])
        self.assertEqual(len(self.db.rows), 1)

    def test_plain_put_on_master_title_only_keeps_exceptions(self):
        m = self._moved_override_series()
        self.client.put(f"/api/events/{m['id']}", json={"title": "Renamed"})
        self.assertEqual(self.row(m["id"])["exdates"], ["2026-10-21T16:00:00+00:00"])
        self.assertEqual(len(self.db.rows), 2)

    # -- fix 5: series with nothing left are deleted --

    def test_delete_this_last_visible_occurrence_deletes_master(self):
        m = self.create(start_at="2026-09-30T16:00:00Z", end_at="2026-09-30T17:00:00Z",
                        rrule="FREQ=WEEKLY;COUNT=2")
        self.delete_occ(m["id"], "2026-09-30T16:00:00Z", "this")
        self.assertIsNotNone(self.row(m["id"]))
        self.delete_occ(m["id"], "2026-10-07T16:00:00Z", "this")
        self.assertEqual(self.db.rows, [])

    def test_delete_following_leaving_only_exdates_deletes_master(self):
        m = self.create(start_at="2026-09-30T16:00:00Z", end_at="2026-09-30T17:00:00Z",
                        rrule="FREQ=WEEKLY;COUNT=3")
        self.delete_occ(m["id"], "2026-09-30T16:00:00Z", "this")
        self.delete_occ(m["id"], "2026-10-07T16:00:00Z", "following")
        self.assertEqual(self.db.rows, [])

    def test_series_with_override_survives_deleting_other_occurrences(self):
        m = self.create(start_at="2026-09-30T16:00:00Z", end_at="2026-09-30T17:00:00Z",
                        rrule="FREQ=WEEKLY;COUNT=2")
        self.put_occ(m["id"], "2026-09-30T16:00:00Z", {"scope": "this", "title": "Kept"})
        self.delete_occ(m["id"], "2026-10-07T16:00:00Z", "this")
        self.assertIsNotNone(self.row(m["id"]))
        self.assertEqual([e["title"] for e in self.events()], ["Kept"])

    # -- fix 6: scope-only "this" save is a no-op --

    def test_this_with_no_fields_is_noop(self):
        m = self.weekly_wed()
        res = self.put_occ(m["id"], "2026-10-07T16:00:00Z", {"scope": "this"})
        self.assertEqual(res["start_at"], "2026-10-07T16:00:00+00:00")
        self.assertEqual(res["rrule"], "FREQ=WEEKLY;BYDAY=WE")
        self.assertEqual(len(self.db.rows), 1)

    # -- fix 7: end must be after start --

    def test_rejects_end_not_after_start(self):
        bad = {"title": "x", "start_at": "2026-10-01T16:00:00Z", "end_at": "2026-10-01T16:00:00Z"}
        self.assertEqual(self.client.post("/api/events", json=bad).status_code, 400)
        self.assertEqual(self.client.post("/api/events", json={**bad, "rrule": "FREQ=DAILY"}).status_code, 400)

        plain = self.create(start_at="2026-10-01T16:00:00Z", end_at="2026-10-01T17:00:00Z")
        res = self.client.put(f"/api/events/{plain['id']}", json={"end_at": "2026-10-01T15:00:00Z"})
        self.assertEqual(res.status_code, 400)

        m = self.weekly_wed()
        for scope in ("this", "following", "all"):
            with self.subTest(scope=scope):
                self.put_occ(m["id"], "2026-10-07T16:00:00Z",
                             {"scope": scope, "start_at": "2026-10-07T18:00:00Z",
                              "end_at": "2026-10-07T17:00:00Z"}, status=400)
        self.assertEqual(len(self.db.rows), 2)

    # -- fix 8: cache invalidated even when a mutation fails midway --

    def test_cache_invalidated_on_partial_failure(self):
        m = self.weekly_wed()
        self.put_occ(m["id"], "2026-10-07T16:00:00Z", {"scope": "this", "title": "Moved"})
        self.assertIn("Moved", [e["title"] for e in self.events()])  # now cached

        # delete-this removes the override, then fails writing exdates.
        self.app.logger.disabled = True  # expected 500; keep test output clean
        self.db.fail_on = "update"
        res = self.client.delete(f"/api/events/{m['id']}/occurrences/2026-10-07T16:00:00Z?scope=this")
        self.assertEqual(res.status_code, 500)
        self.db.fail_on = None

        self.assertNotIn("Moved", [e["title"] for e in self.events()])

    def test_cache_invalidated_on_validation_error(self):
        with mock.patch.object(es.cache, "delete_memoized") as invalidate:
            with self.assertRaises(ValueError):
                es.update_occurrence("any", None, {"scope": "bogus"})
            invalidate.assert_called_once_with(es.get_events)

    # -- basics --

    def test_get_merges_instances_and_overrides_sorted(self):
        m = self.weekly_wed()
        self.create(start_at="2026-10-01T12:00:00Z", end_at="2026-10-01T13:00:00Z", title="Plain")
        self.put_occ(m["id"], "2026-10-07T16:00:00Z", {"scope": "this", "start_at": "2026-10-06T16:00:00Z",
                                                       "end_at": "2026-10-06T17:00:00Z"})
        evs = self.events(end="2026-10-15T00:00:00Z")
        self.assertEqual([e["start_at"] for e in evs], [
            "2026-09-30T16:00:00+00:00", "2026-10-01T12:00:00+00:00",
            "2026-10-06T16:00:00+00:00", "2026-10-14T16:00:00+00:00"])
        override = evs[2]
        self.assertEqual((override["recurring_event_id"], override["rrule"]), (m["id"], "FREQ=WEEKLY;BYDAY=WE"))
        self.assertEqual(evs[0]["id"], f"{m['id']}_{int(es.parse_instant('2026-09-30T16:00:00Z').timestamp())}")

    def test_occurrence_errors(self):
        m = self.weekly_wed()
        self.put_occ(m["id"], "2026-10-08T16:00:00Z", {"scope": "this"}, status=400)  # not an occurrence
        self.put_occ(m["id"], "not-a-date", {"scope": "this"}, status=400)
        self.put_occ(m["id"], "2026-10-07T16:00:00Z", {"scope": "sometimes"}, status=400)
        self.delete_occ(m["id"], "2026-10-07T16:00:00Z", "", status=400)
        self.put_occ("00000000-0000-0000-0000-000000000000", "2026-10-07T16:00:00Z",
                     {"scope": "this"}, status=404)


if __name__ == "__main__":
    unittest.main()
