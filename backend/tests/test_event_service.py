"""Service/API tests for recurring events against an in-memory fake Supabase."""

import unittest
from unittest import mock

from app_case import AppTestCase

from app.services import event_service as es

LA = "America/Los_Angeles"


class EventServiceTest(AppTestCase):
    # -- helpers --

    def create(self, **body):
        body.setdefault("title", "Standup")
        res = self.client.post("/api/events", json=body)
        self.assertEqual(res.status_code, 201, res.get_json())
        return res.get_json()

    def weekly_wed(self, **kw):
        # Wednesdays 9:00-10:00 PDT, starting Wed 2026-09-30.
        return self.create(
            start_at="2026-09-30T16:00:00Z",
            end_at="2026-09-30T17:00:00Z",
            timezone=LA,
            rrule="FREQ=WEEKLY;BYDAY=WE",
            **kw,
        )

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
        self.put_occ(
            m["id"],
            "2026-10-14T16:00:00Z",
            {"scope": "all", "start_at": "2026-10-15T16:00:00Z", "end_at": "2026-10-15T17:00:00Z"},
        )
        master = self.row(m["id"])
        self.assertEqual(master["rrule"], "FREQ=WEEKLY;BYDAY=TH")
        self.assertEqual(master["start_at"], "2026-10-01T16:00:00+00:00")
        self.assertEqual(
            self.starts()[:3], ["2026-10-01T16:00:00+00:00", "2026-10-08T16:00:00+00:00", "2026-10-15T16:00:00+00:00"]
        )

    def test_following_move_to_other_day_keeps_moved_instance(self):
        m = self.weekly_wed()
        new = self.put_occ(
            m["id"],
            "2026-10-07T16:00:00Z",
            {"scope": "following", "start_at": "2026-10-08T16:00:00Z", "end_at": "2026-10-08T17:00:00Z"},
        )
        self.assertEqual(new["rrule"], "FREQ=WEEKLY;BYDAY=TH")
        self.assertEqual(new["start_at"], "2026-10-08T16:00:00+00:00")
        self.assertEqual(
            self.starts()[:3], ["2026-09-30T16:00:00+00:00", "2026-10-08T16:00:00+00:00", "2026-10-15T16:00:00+00:00"]
        )

    def test_explicit_new_rule_keeps_snap_behaviour(self):
        m = self.weekly_wed()
        new = self.put_occ(
            m["id"],
            "2026-10-07T16:00:00Z",
            {
                "scope": "following",
                "start_at": "2026-10-08T16:00:00Z",
                "end_at": "2026-10-08T17:00:00Z",
                "rrule": "FREQ=WEEKLY;BYDAY=MO",
            },
        )
        self.assertEqual(new["rrule"], "FREQ=WEEKLY;BYDAY=MO")
        self.assertEqual(new["start_at"], "2026-10-12T16:00:00+00:00")

    # -- fix 2: edits are measured against the instance's current times --

    def _moved_override_series(self):
        m = self.weekly_wed()
        self.put_occ(
            m["id"],
            "2026-10-14T16:00:00Z",
            {"scope": "this", "start_at": "2026-10-14T18:00:00Z", "end_at": "2026-10-14T20:00:00Z"},
        )
        self.delete_occ(m["id"], "2026-10-21T16:00:00Z", "this")
        return m

    def test_all_title_only_save_of_moved_override(self):
        m = self._moved_override_series()
        # Frontend sends the override's current times back unchanged.
        self.put_occ(
            m["id"],
            "2026-10-14T16:00:00Z",
            {"scope": "all", "title": "Sync", "start_at": "2026-10-14T18:00:00Z", "end_at": "2026-10-14T20:00:00Z"},
        )
        master = self.row(m["id"])
        self.assertEqual(
            (master["start_at"], master["end_at"]), ("2026-09-30T16:00:00+00:00", "2026-09-30T17:00:00+00:00")
        )
        self.assertEqual(master["exdates"], ["2026-10-21T16:00:00+00:00"])
        evs = self.events()
        self.assertTrue(all(e["title"] == "Sync" for e in evs))
        self.assertIn("2026-10-14T18:00:00+00:00", [e["start_at"] for e in evs])
        self.assertNotIn("2026-10-21T16:00:00+00:00", [e["start_at"] for e in evs])

    def test_all_move_of_moved_override_applies_relative_shift(self):
        m = self._moved_override_series()
        # Override sits at 18:00; nudge it +1h -> series moves +1h (not +3h).
        self.put_occ(
            m["id"],
            "2026-10-14T16:00:00Z",
            {"scope": "all", "start_at": "2026-10-14T19:00:00Z", "end_at": "2026-10-14T21:00:00Z"},
        )
        master = self.row(m["id"])
        self.assertEqual(
            (master["start_at"], master["end_at"]), ("2026-09-30T17:00:00+00:00", "2026-09-30T18:00:00+00:00")
        )
        self.assertEqual(master["exdates"], [])
        self.assertEqual([r for r in self.db.rows if r["recurring_event_id"]], [])

    def test_following_title_only_save_of_moved_override(self):
        m = self._moved_override_series()
        new = self.put_occ(
            m["id"],
            "2026-10-14T16:00:00Z",
            {
                "scope": "following",
                "title": "Later",
                "start_at": "2026-10-14T18:00:00Z",
                "end_at": "2026-10-14T20:00:00Z",
            },
        )
        self.assertEqual(new["start_at"], "2026-10-14T16:00:00+00:00")
        self.assertEqual(new["exdates"], ["2026-10-21T16:00:00+00:00"])
        override = next(r for r in self.db.rows if r["recurring_event_id"])
        self.assertEqual(override["recurring_event_id"], new["id"])
        self.assertEqual((override["start_at"], override["title"]), ("2026-10-14T18:00:00+00:00", "Later"))

    # -- fix 3: pathological rules are rejected --

    def test_rejects_pathological_rules(self):
        for rule in [
            "FREQ=SECONDLY",
            "FREQ=DAILY;COUNT=5000",
            "FREQ=DAILY;UNTIL=21000101T000000Z",
            "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30",
            "FREQ=DAILY;BYSETPOS=1",
        ]:
            with self.subTest(rule=rule):
                res = self.client.post(
                    "/api/events",
                    json={
                        "title": "x",
                        "start_at": "2026-10-01T16:00:00Z",
                        "end_at": "2026-10-01T17:00:00Z",
                        "rrule": rule,
                    },
                )
                self.assertEqual(res.status_code, 400)
        self.assertEqual(self.db.rows, [])

    # -- fix 4: plain PUT on a master resets exdates / overrides --

    def test_plain_put_on_master_clears_exceptions(self):
        m = self._moved_override_series()
        res = self.client.put(
            f"/api/events/{m['id']}", json={"start_at": "2026-09-30T17:00:00Z", "end_at": "2026-09-30T18:00:00Z"}
        )
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
        m = self.create(start_at="2026-09-30T16:00:00Z", end_at="2026-09-30T17:00:00Z", rrule="FREQ=WEEKLY;COUNT=2")
        self.delete_occ(m["id"], "2026-09-30T16:00:00Z", "this")
        self.assertIsNotNone(self.row(m["id"]))
        self.delete_occ(m["id"], "2026-10-07T16:00:00Z", "this")
        self.assertEqual(self.db.rows, [])

    def test_delete_following_leaving_only_exdates_deletes_master(self):
        m = self.create(start_at="2026-09-30T16:00:00Z", end_at="2026-09-30T17:00:00Z", rrule="FREQ=WEEKLY;COUNT=3")
        self.delete_occ(m["id"], "2026-09-30T16:00:00Z", "this")
        self.delete_occ(m["id"], "2026-10-07T16:00:00Z", "following")
        self.assertEqual(self.db.rows, [])

    def test_series_with_override_survives_deleting_other_occurrences(self):
        m = self.create(start_at="2026-09-30T16:00:00Z", end_at="2026-09-30T17:00:00Z", rrule="FREQ=WEEKLY;COUNT=2")
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
                self.put_occ(
                    m["id"],
                    "2026-10-07T16:00:00Z",
                    {"scope": scope, "start_at": "2026-10-07T18:00:00Z", "end_at": "2026-10-07T17:00:00Z"},
                    status=400,
                )
        self.assertEqual(len(self.db.rows), 2)

    # -- fix 8: cache invalidated even when a mutation fails midway --

    def test_cache_invalidated_on_partial_failure(self):
        m = self.weekly_wed()
        self.put_occ(m["id"], "2026-10-07T16:00:00Z", {"scope": "this", "title": "Moved"})
        self.assertIn("Moved", [e["title"] for e in self.events()])  # now cached

        # delete-this removes the override, then fails writing exdates.
        self.quiet_errors()  # expected 500
        self.db.fail_on = "update"
        res = self.client.delete(f"/api/events/{m['id']}/occurrences/2026-10-07T16:00:00Z?scope=this")
        self.assertEqual(res.status_code, 500)
        self.db.fail_on = None

        self.assertNotIn("Moved", [e["title"] for e in self.events()])

    def test_cache_invalidated_on_validation_error(self):
        with self.app.app_context(), mock.patch.object(es.cache, "delete_memoized") as invalidate:
            with self.assertRaises(ValueError):
                es.update_occurrence("any", None, {"scope": "bogus"})
            invalidate.assert_called_once_with(es.get_events)

    # -- input validation --

    def test_create_validation(self):
        ok = {"title": "x", "start_at": "2026-10-01T16:00:00Z", "end_at": "2026-10-01T17:00:00Z"}
        bad = [
            {k: val for k, val in ok.items() if k != "title"},
            {k: val for k, val in ok.items() if k != "start_at"},
            {**ok, "title": None},
            {**ok, "title": " "},
            {**ok, "start_at": None},
            {**ok, "end_at": "later"},
            {**ok, "timezone": "Mars/Olympus"},
            {**ok, "timezone": None},
            {**ok, "all_day": "yes"},
            {**ok, "rrule": 7},
            {**ok, "rrule": "FREQ=DAILY", "timezone": "Mars/Olympus"},
        ]
        for body in bad:
            with self.subTest(body=body):
                self.assertEqual(self.client.post("/api/events", json=body).status_code, 400)
        self.assertEqual(self.db.rows, [])
        self.assertEqual(self.create(**ok)["timezone"], "UTC")

    def test_update_validation(self):
        plain = self.create(start_at="2026-10-01T16:00:00Z", end_at="2026-10-01T17:00:00Z")
        for body in [{"timezone": "Mars/Olympus"}, {"timezone": None}, {"title": None}, {"start_at": None}]:
            with self.subTest(body=body):
                res = self.client.put(f"/api/events/{plain['id']}", json=body)
                self.assertEqual(res.status_code, 400)
        m = self.weekly_wed()
        for scope in ("this", "following", "all"):
            with self.subTest(scope=scope):
                self.put_occ(m["id"], "2026-10-07T16:00:00Z", {"scope": scope, "timezone": "Mars/Olympus"}, status=400)
                self.put_occ(m["id"], "2026-10-07T16:00:00Z", {"scope": scope, "title": None}, status=400)
        self.assertEqual(len(self.db.rows), 2)

    def test_update_without_known_fields_returns_current_row(self):
        plain = self.create(start_at="2026-10-01T16:00:00Z", end_at="2026-10-01T17:00:00Z")
        res = self.client.put(f"/api/events/{plain['id']}", json={"bogus": True})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json(), plain)

    # -- B6: a "following" split that leaves the old series empty deletes it --

    def test_following_split_drops_fully_cancelled_old_series(self):
        m = self.weekly_wed()
        self.delete_occ(m["id"], "2026-09-30T16:00:00Z", "this")
        new = self.put_occ(m["id"], "2026-10-07T16:00:00Z", {"scope": "following", "title": "New"})
        self.assertIsNone(self.row(m["id"]))
        self.assertEqual([r["id"] for r in self.db.rows], [new["id"]])
        self.assertEqual(self.starts()[0], "2026-10-07T16:00:00+00:00")

    def test_following_split_keeps_old_series_with_visible_occurrence(self):
        m = self.weekly_wed()
        self.put_occ(m["id"], "2026-10-07T16:00:00Z", {"scope": "following", "title": "New"})
        self.assertEqual(self.row(m["id"])["rrule"], "FREQ=WEEKLY;BYDAY=WE;UNTIL=20261007T155959Z")

    # -- B7: all/following from an override also update that override --

    def test_all_from_override_applies_fields_equal_to_series(self):
        m = self.weekly_wed(description="Daily sync")
        self.put_occ(m["id"], "2026-10-14T16:00:00Z", {"scope": "this", "title": "Special", "description": "x"})
        self.put_occ(m["id"], "2026-10-21T16:00:00Z", {"scope": "this", "title": "Other"})
        # Title reverted to the series value; description changed for everyone.
        self.put_occ(m["id"], "2026-10-14T16:00:00Z", {"scope": "all", "title": "Standup", "description": "New"})
        by_start = {e["start_at"]: e for e in self.events()}
        clicked = by_start["2026-10-14T16:00:00+00:00"]
        self.assertEqual((clicked["title"], clicked["description"]), ("Standup", "New"))
        other = by_start["2026-10-21T16:00:00+00:00"]
        self.assertEqual((other["title"], other["description"]), ("Other", "New"))
        self.assertEqual(self.row(m["id"])["description"], "New")

    def test_following_from_override_applies_fields_equal_to_series(self):
        m = self.weekly_wed()
        self.put_occ(m["id"], "2026-10-14T16:00:00Z", {"scope": "this", "title": "Special"})
        new = self.put_occ(m["id"], "2026-10-14T16:00:00Z", {"scope": "following", "title": "Standup"})
        override = next(r for r in self.db.rows if r["recurring_event_id"])
        self.assertEqual((override["recurring_event_id"], override["title"]), (new["id"], "Standup"))

    # -- B8: overrides and cancelled occurrences --

    def test_plain_delete_of_override_cancels_the_occurrence(self):
        m = self.weekly_wed()
        override = self.put_occ(m["id"], "2026-10-14T16:00:00Z", {"scope": "this", "title": "Moved"})
        res = self.client.delete(f"/api/events/{override['id']}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["id"], override["id"])
        self.assertEqual(self.row(m["id"])["exdates"], ["2026-10-14T16:00:00+00:00"])
        self.assertNotIn("2026-10-14T16:00:00+00:00", self.starts())
        self.assertEqual(len(self.db.rows), 1)

    def test_plain_delete_of_last_override_drops_empty_series(self):
        m = self.create(start_at="2026-09-30T16:00:00Z", end_at="2026-09-30T17:00:00Z", rrule="FREQ=WEEKLY;COUNT=2")
        override = self.put_occ(m["id"], "2026-09-30T16:00:00Z", {"scope": "this", "title": "Kept"})
        self.delete_occ(m["id"], "2026-10-07T16:00:00Z", "this")
        self.assertEqual(self.client.delete(f"/api/events/{override['id']}").status_code, 200)
        self.assertEqual(self.db.rows, [])

    def test_editing_cancelled_occurrence_is_404(self):
        m = self.weekly_wed()
        self.delete_occ(m["id"], "2026-10-14T16:00:00Z", "this")
        for scope in ("this", "following", "all"):
            with self.subTest(scope=scope):
                self.put_occ(m["id"], "2026-10-14T16:00:00Z", {"scope": scope, "title": "Back"}, status=404)
        self.assertEqual(len(self.db.rows), 1)
        self.assertEqual(self.row(m["id"])["title"], "Standup")

    # -- B9: a start-only edit keeps the end, in every scope --

    def test_start_only_edit_keeps_end(self):
        early = {"start_at": "2026-10-14T15:00:00Z"}  # 8:00 PDT; end stays 10:00
        cases = {
            "this": ("2026-10-14T15:00:00+00:00", "2026-10-14T17:00:00+00:00"),
            "following": ("2026-10-14T15:00:00+00:00", "2026-10-14T17:00:00+00:00"),
            "all": ("2026-09-30T15:00:00+00:00", "2026-09-30T17:00:00+00:00"),
        }
        for scope, expected in cases.items():
            with self.subTest(scope=scope):
                self.db.rows.clear()
                m = self.weekly_wed()
                row = self.put_occ(m["id"], "2026-10-14T16:00:00Z", {"scope": scope, **early})
                self.assertEqual((row["start_at"], row["end_at"]), expected)
                self.assertIn(("2026-10-14T15:00:00+00:00", "2026-10-14T17:00:00+00:00"),
                              [(e["start_at"], e["end_at"]) for e in self.events()])  # fmt: skip

    def test_start_only_edit_past_end_is_400(self):
        m = self.weekly_wed()
        for scope in ("this", "following", "all"):
            with self.subTest(scope=scope):
                self.put_occ(m["id"], "2026-10-14T16:00:00Z", {"scope": scope, "start_at": "2026-10-14T17:30:00Z"},
                             status=400)  # fmt: skip
        self.assertEqual(len(self.db.rows), 1)

    # -- B17: occurrences keep their wall-clock duration across DST --

    def _weekend_series(self):
        # Sat 9:00 -> Mon 9:00 PT weekly; DST ends Sun 2026-11-01.
        return self.create(start_at="2026-10-24T16:00:00Z", end_at="2026-10-26T16:00:00Z", timezone=LA,
                           rrule="FREQ=WEEKLY;BYDAY=SA")  # fmt: skip

    def test_multi_day_occurrence_across_dst_ends_at_local_time(self):
        self._weekend_series()
        evs = self.events(start="2026-10-30T00:00:00Z", end="2026-11-08T00:00:00Z")
        self.assertEqual(
            (evs[0]["start_at"], evs[0]["end_at"]), ("2026-10-31T16:00:00+00:00", "2026-11-02T17:00:00+00:00")
        )

    def test_edits_from_dst_crossing_instance_keep_series_duration(self):
        m = self._weekend_series()
        self.put_occ(m["id"], "2026-10-31T16:00:00Z", {"scope": "all", "title": "Trip"})
        self.assertEqual(self.row(m["id"])["end_at"], "2026-10-26T16:00:00+00:00")
        new = self.put_occ(m["id"], "2026-11-07T17:00:00Z", {"scope": "following", "title": "Later"})
        self.assertEqual((new["start_at"], new["end_at"]), ("2026-11-07T17:00:00+00:00", "2026-11-09T17:00:00+00:00"))

    # -- basics --

    def test_get_merges_instances_and_overrides_sorted(self):
        m = self.weekly_wed()
        self.create(start_at="2026-10-01T12:00:00Z", end_at="2026-10-01T13:00:00Z", title="Plain")
        self.put_occ(
            m["id"],
            "2026-10-07T16:00:00Z",
            {"scope": "this", "start_at": "2026-10-06T16:00:00Z", "end_at": "2026-10-06T17:00:00Z"},
        )
        evs = self.events(end="2026-10-15T00:00:00Z")
        self.assertEqual(
            [e["start_at"] for e in evs],
            [
                "2026-09-30T16:00:00+00:00",
                "2026-10-01T12:00:00+00:00",
                "2026-10-06T16:00:00+00:00",
                "2026-10-14T16:00:00+00:00",
            ],
        )
        override = evs[2]
        self.assertEqual((override["recurring_event_id"], override["rrule"]), (m["id"], "FREQ=WEEKLY;BYDAY=WE"))
        self.assertEqual(evs[0]["id"], f"{m['id']}_{int(es.parse_instant('2026-09-30T16:00:00Z').timestamp())}")

    def test_occurrence_errors(self):
        m = self.weekly_wed()
        self.put_occ(m["id"], "2026-10-08T16:00:00Z", {"scope": "this"}, status=400)  # not an occurrence
        self.put_occ(m["id"], "not-a-date", {"scope": "this"}, status=400)
        self.put_occ(m["id"], "2026-10-07T16:00:00Z", {"scope": "sometimes"}, status=400)
        self.delete_occ(m["id"], "2026-10-07T16:00:00Z", "", status=400)
        self.put_occ("00000000-0000-0000-0000-000000000000", "2026-10-07T16:00:00Z", {"scope": "this"}, status=404)


if __name__ == "__main__":
    unittest.main()
