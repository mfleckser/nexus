"""Service/API tests for recurring events against an in-memory fake Supabase."""

import unittest
from datetime import UTC, datetime
from unittest import mock

from app_case import AppTestCase
from supabase import PostgrestAPIError

from app.services import event_service as es

LA = "America/Los_Angeles"


class EventServiceTest(AppTestCase):
    AN_HOUR_LATER = {"start_at": "2026-10-14T17:00:00Z", "end_at": "2026-10-14T18:00:00Z"}

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
        # The cancelled occurrence moves with the series and stays cancelled;
        # the clicked override lands where it was dropped.
        self.assertEqual(master["exdates"], ["2026-10-21T17:00:00+00:00"])
        (override,) = [r for r in self.db.rows if r["recurring_event_id"]]
        self.assertEqual(
            (override["original_start_at"], override["start_at"], override["end_at"]),
            ("2026-10-14T17:00:00+00:00", "2026-10-14T19:00:00+00:00", "2026-10-14T21:00:00+00:00"),
        )
        self.assertEqual(
            self.starts(),
            [
                "2026-09-30T17:00:00+00:00",
                "2026-10-07T17:00:00+00:00",
                "2026-10-14T19:00:00+00:00",
                "2026-10-28T17:00:00+00:00",
            ],
        )

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

    # -- fix 4: plain PUT on a master moves exdates / overrides along --

    def test_plain_put_on_master_shifts_exceptions(self):
        m = self._moved_override_series()
        res = self.client.put(
            f"/api/events/{m['id']}", json={"start_at": "2026-09-30T17:00:00Z", "end_at": "2026-09-30T18:00:00Z"}
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["exdates"], ["2026-10-21T17:00:00+00:00"])
        (override,) = [r for r in self.db.rows if r["recurring_event_id"]]
        self.assertEqual(
            (override["original_start_at"], override["start_at"], override["end_at"]),
            ("2026-10-14T17:00:00+00:00", "2026-10-14T19:00:00+00:00", "2026-10-14T21:00:00+00:00"),
        )

    def test_plain_put_removing_rrule_drops_exceptions(self):
        m = self._moved_override_series()
        res = self.client.put(f"/api/events/{m['id']}", json={"rrule": None})
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.get_json()["rrule"], res.get_json()["exdates"]), (None, []))
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

    # -- time-blocked tasks follow a split that drops the old master --

    SPLIT = {"scope": "following", "start_at": "2026-10-07T17:00:00Z", "end_at": "2026-10-07T18:00:00Z"}

    def _droppable_series(self):
        """Weekly Wed with its first occurrence cancelled, so a "following" split at
        the second leaves nothing before it; plus tasks on it, on another event,
        and on none."""
        m = self.weekly_wed()
        self.delete_occ(m["id"], "2026-09-30T16:00:00Z", "this")
        other = self.create(title="Other", start_at="2026-10-01T16:00:00Z", end_at="2026-10-01T17:00:00Z")
        tasks = {
            name: self.client.post("/api/tasks", json={"title": name, "event_id": ev}).get_json()["id"]
            for name, ev in (("a", m["id"]), ("b", m["id"]), ("other", other["id"]), ("none", None))
        }
        return m, other, tasks

    def task_links(self, tasks):
        return {name: self.client.get(f"/api/tasks/{tid}").get_json()["event_id"] for name, tid in tasks.items()}

    def split_ops(self, m):
        """The ops the split sends, in order (spied, still applied)."""
        with mock.patch.object(es, "_apply", wraps=es._apply) as spy:
            new = self.put_occ(m["id"], "2026-10-07T16:00:00Z", self.SPLIT)
        spy.assert_called_once()  # one RPC, one transaction
        return new, spy.call_args.args[0]

    def test_following_split_that_drops_the_master_keeps_task_links(self):
        m, other, tasks = self._droppable_series()
        self.assertEqual(len(self.client.get("/api/tasks").get_json()), 4)  # warm the tasks cache
        new, ops = self.split_ops(m)
        self.assertIsNone(self.row(m["id"]))
        expected = {"a": new["id"], "b": new["id"], "other": other["id"], "none": None}
        # The cached list was cleared by the edit, not served stale.
        self.assertEqual({t["title"]: t["event_id"] for t in self.client.get("/api/tasks").get_json()}, expected)
        self.assertEqual(self.task_links(tasks), expected)
        # One transaction: insert the new master, relink, then delete the old one.
        kinds = [op["op"] for op in ops]
        self.assertEqual((kinds[0], kinds[-2:]), ("insert", ["relink_tasks", "delete"]))
        self.assertEqual(ops[-2], {"op": "relink_tasks", "from": m["id"], "to": new["id"]})

    def test_following_split_that_keeps_the_master_leaves_task_links(self):
        # Before the series starts, so the earlier half holds the next occurrence
        # (test_task_links covers the task following the later half).
        m = self.weekly_wed()
        tid = self.client.post("/api/tasks", json={"title": "T", "event_id": m["id"]}).get_json()["id"]
        with mock.patch.object(es, "_now", return_value=datetime(2026, 9, 1, tzinfo=UTC)):
            _, ops = self.split_ops(m)
        self.assertNotIn("relink_tasks", [op["op"] for op in ops])
        self.assertEqual(self.task_links({"t": tid}), {"t": m["id"]})

    def test_failure_after_relink_rolls_back_the_task_links(self):
        m, other, tasks = self._droppable_series()
        before_events = [dict(r) for r in self.db.rows]
        before_tasks = [dict(r) for r in self.db.tables["tasks"]]
        real_apply = es._apply

        def fail_after_relink(ops, result_id=None):
            self.db.fail_after_ops = [op["op"] for op in ops].index("relink_tasks") + 1
            return real_apply(ops, result_id)

        self.quiet_errors()
        with mock.patch.object(es, "_apply", side_effect=fail_after_relink):
            res = self.client.put(f"/api/events/{m['id']}/occurrences/2026-10-07T16:00:00Z", json=self.SPLIT)
        self.db.fail_after_ops = None
        self.assertEqual(res.status_code, 500)
        self.assertEqual(self.db.rows, before_events)
        self.assertEqual(self.db.tables["tasks"], before_tasks)
        self.assertEqual(self.task_links(tasks), {"a": m["id"], "b": m["id"], "other": other["id"], "none": None})

    def apply(self, ops):
        """_apply as a service write runs it: under the lock, clearing the caches."""
        return es.invalidates_events(es._apply)(ops)

    def insert_op(self, m):
        new_id = "00000000-0000-0000-0000-0000000000aa"
        return new_id, {
            "op": "insert",
            "row": {"id": new_id, "title": "New", **{k: m[k] for k in ("start_at", "end_at")}},
        }

    def test_relink_tasks_op_needs_the_target_inserted_and_the_source_not_yet_deleted(self):
        m, other, tasks = self._droppable_series()
        new_id, insert = self.insert_op(m)
        relink = es._relink_tasks_op(m["id"], new_id)
        delete = {"op": "delete", "id": m["id"]}
        with self.app.app_context():
            with self.subTest(order="relink before insert"), self.assertRaises(PostgrestAPIError):
                self.apply([relink, insert, delete])  # FK: no such event yet
            self.assertEqual(self.task_links(tasks)["a"], m["id"])
            with self.subTest(order="delete before relink"):
                self.apply([insert, delete, relink])  # FK already unlinked them
                self.assertEqual(self.task_links(tasks), {"a": None, "b": None, "other": other["id"], "none": None})

    def test_relink_tasks_op_in_order(self):
        m, other, tasks = self._droppable_series()
        new_id, insert = self.insert_op(m)
        with self.app.app_context():
            self.apply([insert, es._relink_tasks_op(m["id"], new_id), {"op": "delete", "id": m["id"]}])
        self.assertEqual(self.task_links(tasks), {"a": new_id, "b": new_id, "other": other["id"], "none": None})

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

    # -- fix 8: a mutation that fails midway changes nothing --

    def test_failed_delete_this_leaves_series_untouched(self):
        m = self.weekly_wed()
        self.put_occ(m["id"], "2026-10-07T16:00:00Z", {"scope": "this", "title": "Moved"})
        self.assertIn("Moved", [e["title"] for e in self.events()])  # now cached
        before = [dict(r) for r in self.db.rows]

        # delete-this removes the override, then fails writing exdates: rolled back.
        self.quiet_errors()  # expected 500
        self.db.fail_on = "update"
        res = self.client.delete(f"/api/events/{m['id']}/occurrences/2026-10-07T16:00:00Z?scope=this")
        self.assertEqual(res.status_code, 500)
        self.db.fail_on = None

        self.assertEqual(self.db.rows, before)
        self.assertIn("Moved", [e["title"] for e in self.events()])

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

    # -- atomic scoped edits: a failure partway changes nothing --

    def _series_with_exceptions(self):
        """Weekly Wed 9:00 PDT; 10-07 cancelled, 10-21 retitled, 10-28 moved +2h."""
        m = self.weekly_wed()
        self.delete_occ(m["id"], "2026-10-07T16:00:00Z", "this")
        self.put_occ(m["id"], "2026-10-21T16:00:00Z", {"scope": "this", "title": "Retitled"})
        self.put_occ(
            m["id"],
            "2026-10-28T16:00:00Z",
            {"scope": "this", "start_at": "2026-10-28T18:00:00Z", "end_at": "2026-10-28T19:00:00Z"},
        )
        return m

    def overrides(self, master_id):
        rows = [r for r in self.db.rows if r["recurring_event_id"] == master_id]
        return sorted((r["original_start_at"], r["start_at"], r["end_at"], r["title"]) for r in rows)

    def test_failed_scoped_edits_change_nothing(self):
        m = self._series_with_exceptions()
        before = [dict(r) for r in self.db.rows]
        self.quiet_errors()
        move = {"start_at": "2026-10-14T17:00:00Z", "end_at": "2026-10-14T18:00:00Z", "title": "New"}
        for scope in ("following", "all"):
            for after in (0, 1, 2):
                with self.subTest(scope=scope, fail_after=after):
                    self.db.fail_after_ops = after
                    res = self.client.put(
                        f"/api/events/{m['id']}/occurrences/2026-10-14T16:00:00Z", json={**move, "scope": scope}
                    )
                    self.assertEqual(res.status_code, 500)
                    self.assertEqual(self.db.rows, before)
        self.db.fail_after_ops = 0
        for scope in ("this", "following"):
            with self.subTest(delete=scope):
                self.delete_occ(m["id"], "2026-10-21T16:00:00Z", scope, status=500)
                self.assertEqual(self.db.rows, before)

    def test_rpc_unknown_row_is_404(self):
        m = self.weekly_wed()
        with self.app.app_context(), self.assertRaises(es.NotFound):
            es._apply([es._update_op("00000000-0000-0000-0000-000000000000", {"title": "x"})])
        self.assertEqual(len(self.db.rows), 1)
        self.assertEqual(self.row(m["id"])["title"], "Standup")

    # -- stale-write guard: another writer between the service's read and write --

    def studio(self, event_id, **fields):
        """Another writer (Studio, another process) changing a row directly."""
        self.db.table("events").update(fields).eq("id", event_id).execute()

    def racing(self, change, times=1):
        """Patch _apply so `change` runs right before each of the first `times`
        RPCs, i.e. after the service read the rows. Returns (patcher, ops of
        each RPC call)."""
        real, calls = es._apply, []

        def apply(ops, result_id=None):
            calls.append(ops)
            if len(calls) <= times:
                change()
            return real(ops, result_id)

        return mock.patch.object(es, "_apply", side_effect=apply), calls

    def test_stale_master_is_redone_from_a_fresh_read(self):
        m = self.weekly_wed()
        patch, calls = self.racing(lambda: self.studio(m["id"], exdates=["2026-10-21T16:00:00Z"]))
        with patch:
            self.put_occ(m["id"], "2026-10-14T16:00:00Z", {"scope": "all", **self.AN_HOUR_LATER})
        self.assertEqual(len(calls), 2)
        # The retry saw Studio's exdate and moved it along with the series.
        self.assertEqual(self.row(m["id"])["exdates"], ["2026-10-21T17:00:00+00:00"])
        self.assertEqual(self.row(m["id"])["start_at"], "2026-09-30T17:00:00+00:00")

    def test_stale_override_is_redone_from_a_fresh_read(self):
        m = self._series_with_exceptions()
        ov = next(r for r in self.db.rows if r["original_start_at"] == "2026-10-28T16:00:00+00:00")
        # After the service read it, Studio moves the override from 11:00 to 13:00 PDT.
        patch, _ = self.racing(
            lambda: self.studio(ov["id"], start_at="2026-10-28T20:00:00Z", end_at="2026-10-28T21:00:00Z")
        )
        with patch:
            self.put_occ(m["id"], "2026-10-14T16:00:00Z", {"scope": "all", **self.AN_HOUR_LATER})
        row = self.row(ov["id"])
        self.assertEqual((row["start_at"], row["end_at"]), ("2026-10-28T21:00:00+00:00", "2026-10-28T22:00:00+00:00"))

    def test_stale_cancel_keeps_the_other_writers_exdate(self):
        m = self.weekly_wed()
        patch, calls = self.racing(lambda: self.studio(m["id"], exdates=["2026-10-21T16:00:00Z"]))
        with patch:
            self.delete_occ(m["id"], "2026-10-07T16:00:00Z", "this")
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.row(m["id"])["exdates"], ["2026-10-07T16:00:00+00:00", "2026-10-21T16:00:00+00:00"])

    def test_edit_still_stale_after_the_retry_is_409(self):
        m = self._series_with_exceptions()
        n = iter(range(100))
        patch, calls = self.racing(lambda: self.studio(m["id"], title=f"Studio {next(n)}"), times=2)
        before = len(self.db.rows)
        with patch:
            res = self.client.put(
                f"/api/events/{m['id']}/occurrences/2026-10-14T16:00:00Z",
                json={"scope": "following", **self.AN_HOUR_LATER},
            )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.get_json(), {"error": "This event was changed elsewhere. Try again."})
        self.assertEqual(len(calls), 2)
        master = self.row(m["id"])
        self.assertEqual(
            (master["title"], master["rrule"], len(self.db.rows)), ("Studio 1", "FREQ=WEEKLY;BYDAY=WE", before)
        )

    def test_every_row_the_edit_read_is_guarded(self):
        all_day = {"all_day": True, "start_at": "2026-10-14T07:00:00Z", "end_at": "2026-10-15T07:00:00Z"}
        edits = {
            "all move": {"scope": "all", **self.AN_HOUR_LATER},
            "following move": {"scope": "following", **self.AN_HOUR_LATER},
            "kind change": {"scope": "all", **all_day},
            "following kind change": {"scope": "following", **all_day},
            "rule cleared": {"scope": "all", "rrule": None},
        }
        for name, body in edits.items():
            with self.subTest(name):
                m = self._series_with_exceptions()
                with mock.patch.object(es, "_apply", wraps=es._apply) as spy:
                    self.put_occ(m["id"], "2026-10-14T16:00:00Z", body)
                guarded = [op for op in spy.call_args.args[0] if op["op"] in ("update", "delete")]
                self.assertTrue(guarded)
                for op in guarded:
                    self.assertIn("expect_updated_at", op, op)

    def test_rpc_refuses_ops_on_changed_rows(self):
        m = self.weekly_wed()
        stamp = self.row(m["id"])["updated_at"]
        with self.app.app_context():
            es._apply([es._update_op(m["id"], {"title": "A"}, {"updated_at": stamp})])
            self.assertEqual(self.row(m["id"])["title"], "A")
            stale = [
                [es._update_op(m["id"], {"title": "B"}, {"updated_at": stamp})],
                [es._delete_op({"id": m["id"], "updated_at": stamp})],
                [es._delete_op({"id": "00000000-0000-0000-0000-000000000000", "updated_at": stamp})],
            ]
            for ops in stale:
                with self.subTest(ops=ops), self.assertRaises(es.Conflict):
                    es._apply(ops)
        self.assertEqual((len(self.db.rows), self.row(m["id"])["title"]), (1, "A"))

    # -- exceptions move with the series --

    def test_all_shift_keeps_exdates_and_overrides(self):
        m = self._series_with_exceptions()
        self.put_occ(
            m["id"],
            "2026-10-14T16:00:00Z",
            {"scope": "all", "start_at": "2026-10-14T17:00:00Z", "end_at": "2026-10-14T18:00:00Z"},
        )
        self.assertEqual(self.row(m["id"])["exdates"], ["2026-10-07T17:00:00+00:00"])
        self.assertEqual(
            self.overrides(m["id"]),
            [
                ("2026-10-21T17:00:00+00:00", "2026-10-21T17:00:00+00:00", "2026-10-21T18:00:00+00:00", "Retitled"),
                ("2026-10-28T17:00:00+00:00", "2026-10-28T19:00:00+00:00", "2026-10-28T20:00:00+00:00", "Standup"),
            ],
        )
        self.assertEqual(
            [(e["start_at"], e["title"]) for e in self.events(end="2026-11-05T00:00:00Z")],
            [
                ("2026-09-30T17:00:00+00:00", "Standup"),
                ("2026-10-14T17:00:00+00:00", "Standup"),
                ("2026-10-21T17:00:00+00:00", "Retitled"),
                ("2026-10-28T19:00:00+00:00", "Standup"),
                ("2026-11-04T18:00:00+00:00", "Standup"),  # 10:00 PST
            ],
        )

    def test_all_shift_by_a_week_moves_overrides_onto_each_others_slots(self):
        m = self.weekly_wed()
        for day in ("07", "14"):
            self.put_occ(m["id"], f"2026-10-{day}T16:00:00Z", {"scope": "this", "title": f"Oct {day}"})
        self.put_occ(
            m["id"],
            "2026-10-07T16:00:00Z",
            {"scope": "all", "start_at": "2026-10-14T16:00:00Z", "end_at": "2026-10-14T17:00:00Z"},
        )
        self.assertEqual(self.row(m["id"])["start_at"], "2026-10-07T16:00:00+00:00")
        self.assertEqual(
            [(o[0], o[3]) for o in self.overrides(m["id"])],
            [("2026-10-14T16:00:00+00:00", "Oct 07"), ("2026-10-21T16:00:00+00:00", "Oct 14")],
        )

    def test_all_timezone_change_keeps_exdates_on_their_local_slot(self):
        m = self.weekly_wed()
        self.delete_occ(m["id"], "2026-11-04T17:00:00Z", "this")  # 9:00 PST
        # Same instant, new zone: Phoenix has no DST, so from November the
        # series sits an hour earlier in UTC than it did in Los Angeles.
        self.put_occ(m["id"], "2026-10-14T16:00:00Z", {"scope": "all", "timezone": "America/Phoenix"})
        self.assertEqual(self.row(m["id"])["exdates"], ["2026-11-04T16:00:00+00:00"])
        self.assertEqual(
            self.starts(start="2026-11-01T00:00:00Z", end="2026-11-15T00:00:00Z"), ["2026-11-11T16:00:00+00:00"]
        )

    def test_all_duration_change_moves_override_ends(self):
        m = self._series_with_exceptions()
        self.put_occ(m["id"], "2026-10-14T16:00:00Z", {"scope": "all", "end_at": "2026-10-14T17:30:00Z"})
        # Detail-only override takes the new length; the moved one keeps its offsets.
        self.assertEqual(
            [o[:3] for o in self.overrides(m["id"])],
            [
                ("2026-10-21T16:00:00+00:00", "2026-10-21T16:00:00+00:00", "2026-10-21T17:30:00+00:00"),
                ("2026-10-28T16:00:00+00:00", "2026-10-28T18:00:00+00:00", "2026-10-28T19:30:00+00:00"),
            ],
        )
        self.assertEqual(self.row(m["id"])["exdates"], ["2026-10-07T16:00:00+00:00"])

    def test_following_shift_carries_later_exceptions(self):
        m = self._series_with_exceptions()
        self.delete_occ(m["id"], "2026-11-04T17:00:00Z", "this")
        new = self.put_occ(
            m["id"],
            "2026-10-21T16:00:00Z",
            {"scope": "following", "start_at": "2026-10-22T16:00:00Z", "end_at": "2026-10-22T17:00:00Z"},
        )
        self.assertEqual((new["rrule"], new["exdates"]), ("FREQ=WEEKLY;BYDAY=TH", ["2026-11-05T17:00:00+00:00"]))
        self.assertEqual(
            self.overrides(new["id"]),
            [
                ("2026-10-22T16:00:00+00:00", "2026-10-22T16:00:00+00:00", "2026-10-22T17:00:00+00:00", "Retitled"),
                ("2026-10-29T16:00:00+00:00", "2026-10-29T18:00:00+00:00", "2026-10-29T19:00:00+00:00", "Standup"),
            ],
        )
        old = self.row(m["id"])
        self.assertEqual((old["exdates"], self.overrides(m["id"])), (["2026-10-07T16:00:00+00:00"], []))
        self.assertEqual(
            self.starts(end="2026-11-10T00:00:00Z"),
            [
                "2026-09-30T16:00:00+00:00",
                "2026-10-14T16:00:00+00:00",
                "2026-10-22T16:00:00+00:00",
                "2026-10-29T18:00:00+00:00",
            ],
        )

    def test_ordinal_weekday_move_keeps_exdates_on_the_same_occurrence(self):
        m = self.create(start_at="2026-01-13T09:00:00Z", end_at="2026-01-13T10:00:00Z", rrule="FREQ=MONTHLY;BYDAY=2TU")
        self.delete_occ(m["id"], "2026-04-14T09:00:00Z", "this")
        # 2nd Tuesday -> 2nd Wednesday. April starts on a Wednesday, so a fixed
        # +1 day would land on the 3rd one; the cancelled April one is Apr 8.
        self.put_occ(
            m["id"],
            "2026-01-13T09:00:00Z",
            {"scope": "all", "start_at": "2026-01-14T09:00:00Z", "end_at": "2026-01-14T10:00:00Z"},
        )
        master = self.row(m["id"])
        self.assertEqual(
            (master["rrule"], master["exdates"]), ("FREQ=MONTHLY;BYDAY=2WE", ["2026-04-08T09:00:00+00:00"])
        )
        self.assertEqual(self.starts(start="2026-04-01T00:00:00Z", end="2026-05-01T00:00:00Z"), [])

    def test_month_end_move_keeps_exceptions_in_their_month(self):
        m = self.create(
            start_at="2027-01-31T09:00:00Z", end_at="2027-01-31T10:00:00Z", rrule="FREQ=MONTHLY;BYMONTHDAY=31"
        )
        self.put_occ(m["id"], "2027-05-31T09:00:00Z", {"scope": "this", "title": "May special"})
        self.delete_occ(m["id"], "2027-07-31T09:00:00Z", "this")
        # The 31st -> the 30th: the new rule also hits April, so pairing by
        # position would put May's override on Apr 30.
        self.put_occ(
            m["id"],
            "2027-01-31T09:00:00Z",
            {"scope": "all", "start_at": "2027-01-30T09:00:00Z", "end_at": "2027-01-30T10:00:00Z"},
        )
        master = self.row(m["id"])
        self.assertEqual(
            (master["rrule"], master["exdates"]), ("FREQ=MONTHLY;BYMONTHDAY=30", ["2027-07-30T09:00:00+00:00"])
        )
        self.assertEqual(
            [(o[0], o[3]) for o in self.overrides(m["id"])], [("2027-05-30T09:00:00+00:00", "May special")]
        )

    def test_paired_exceptions_never_take_a_shifted_ones_slot(self):
        m = self.create(
            start_at="2027-01-30T09:00:00Z", end_at="2027-01-30T10:00:00Z", rrule="FREQ=MONTHLY;BYMONTHDAY=30"
        )
        self.delete_occ(m["id"], "2027-06-30T09:00:00Z", "this")
        self.put_occ(m["id"], "2027-04-30T09:00:00Z", {"scope": "this", "title": "April"})
        self.put_occ(m["id"], "2027-05-30T09:00:00Z", {"scope": "this", "title": "May"})
        # The 30th -> the 31st: April has no 31st, so April's override has no
        # slot left and must not take May's (which May reaches by the shift).
        self.put_occ(
            m["id"],
            "2027-01-30T09:00:00Z",
            {"scope": "all", "start_at": "2027-01-31T09:00:00Z", "end_at": "2027-01-31T10:00:00Z"},
        )
        self.assertEqual(self.row(m["id"])["exdates"], [])  # June has no 31st either
        self.assertEqual([(o[0], o[3]) for o in self.overrides(m["id"])], [("2027-05-31T09:00:00+00:00", "May")])

    def test_move_across_a_month_boundary_drops_exceptions_with_no_slot(self):
        for rule in ("FREQ=MONTHLY", "FREQ=MONTHLY;BYMONTHDAY=1,15"):
            with self.subTest(rule=rule):
                m = self.create(start_at="2027-01-01T09:00:00Z", end_at="2027-01-01T10:00:00Z", rrule=rule)
                self.delete_occ(m["id"], "2027-05-01T09:00:00Z", "this")
                # The 1st -> the day before: May 1 becomes Apr 30, which the new
                # rule (31st [and 14th]) lacks. It must not cancel May 31 / Apr 14.
                self.put_occ(
                    m["id"],
                    "2027-01-01T09:00:00Z",
                    {"scope": "all", "start_at": "2026-12-31T09:00:00Z", "end_at": "2026-12-31T10:00:00Z"},
                )
                self.assertEqual(self.row(m["id"])["exdates"], [])

    def test_implied_rule_parts_are_not_a_new_rule(self):
        m = self.create(
            start_at="2026-09-30T16:00:00Z", end_at="2026-09-30T17:00:00Z", timezone=LA, rrule="FREQ=WEEKLY"
        )
        self.delete_occ(m["id"], "2026-10-14T16:00:00Z", "this")
        self.put_occ(
            m["id"],
            "2026-09-30T16:00:00Z",
            {
                "scope": "all",
                "rrule": "FREQ=WEEKLY;BYDAY=WE",
                "start_at": "2026-10-01T16:00:00Z",
                "end_at": "2026-10-01T17:00:00Z",
            },
        )
        self.assertEqual(self.row(m["id"])["exdates"], ["2026-10-15T16:00:00+00:00"])

    def test_new_rule_only_valid_from_the_edited_start(self):
        m = self.weekly_wed()
        res = self.put_occ(
            m["id"],
            "2026-09-30T16:00:00Z",
            {
                "scope": "all",
                "start_at": "2026-09-29T16:00:00Z",
                "end_at": "2026-09-29T17:00:00Z",
                "rrule": "FREQ=DAILY;UNTIL=20260929T235959Z",
            },
        )
        self.assertEqual(res["start_at"], "2026-09-29T16:00:00+00:00")

    def test_reordered_byday_is_not_a_new_rule(self):
        m = self.create(start_at="2026-09-28T16:00:00Z", end_at="2026-09-28T17:00:00Z", rrule="FREQ=WEEKLY;BYDAY=MO,WE")
        self.delete_occ(m["id"], "2026-10-07T16:00:00Z", "this")
        self.put_occ(
            m["id"],
            "2026-09-28T16:00:00Z",
            {
                "scope": "all",
                "rrule": "FREQ=WEEKLY;WKST=MO;BYDAY=WE,MO",
                "start_at": "2026-09-29T16:00:00Z",
                "end_at": "2026-09-29T17:00:00Z",
            },
        )
        master = self.row(m["id"])
        self.assertEqual(
            (master["rrule"], master["exdates"]), ("FREQ=WEEKLY;BYDAY=TU,TH", ["2026-10-08T16:00:00+00:00"])
        )

    def test_equivalent_rule_spelling_is_not_a_new_rule(self):
        m = self._series_with_exceptions()
        self.put_occ(
            m["id"],
            "2026-10-14T16:00:00Z",
            {
                "scope": "all",
                "rrule": "freq=weekly;interval=1;byday=WE",
                "start_at": "2026-10-15T16:00:00Z",
                "end_at": "2026-10-15T17:00:00Z",
            },
        )
        master = self.row(m["id"])
        # Treated as the series' own rule, so it is re-aimed and keeps its exceptions.
        self.assertEqual(master["exdates"], ["2026-10-08T16:00:00+00:00"])
        self.assertEqual(len(self.overrides(m["id"])), 2)

    def test_move_shifts_until_so_the_last_occurrence_stays(self):
        m = self.weekly_wed()
        self.put_occ(
            m["id"], "2026-09-30T16:00:00Z", {"scope": "all", "rrule": "FREQ=WEEKLY;BYDAY=WE;UNTIL=20261028T160000Z"}
        )
        self.delete_occ(m["id"], "2026-10-28T16:00:00Z", "this")
        self.put_occ(
            m["id"],
            "2026-10-07T16:00:00Z",
            {"scope": "all", "start_at": "2026-10-08T16:00:00Z", "end_at": "2026-10-08T17:00:00Z"},
        )
        master = self.row(m["id"])
        self.assertEqual(master["rrule"], "FREQ=WEEKLY;BYDAY=TH;UNTIL=20261029T160000Z")
        self.assertEqual(master["exdates"], ["2026-10-29T16:00:00+00:00"])

    def test_timezone_change_re_aims_weekday_by_the_new_local_day(self):
        # Wed 02:00 UTC is Tue 19:00 in Los Angeles.
        m = self.create(start_at="2026-09-30T02:00:00Z", end_at="2026-09-30T03:00:00Z", rrule="FREQ=WEEKLY;BYDAY=WE")
        self.delete_occ(m["id"], "2026-10-14T02:00:00Z", "this")
        self.put_occ(m["id"], "2026-09-30T02:00:00Z", {"scope": "all", "timezone": LA})
        master = self.row(m["id"])
        self.assertEqual((master["rrule"], master["exdates"]), ("FREQ=WEEKLY;BYDAY=TU", ["2026-10-14T02:00:00+00:00"]))
        self.assertEqual(
            self.starts(end="2026-10-25T00:00:00Z"),
            ["2026-09-30T02:00:00+00:00", "2026-10-07T02:00:00+00:00", "2026-10-21T02:00:00+00:00"],
        )

    def test_plain_put_on_master_to_another_day_re_aims_rule(self):
        m = self._series_with_exceptions()
        res = self.client.put(
            f"/api/events/{m['id']}", json={"start_at": "2026-10-01T16:00:00Z", "end_at": "2026-10-01T17:00:00Z"}
        )
        self.assertEqual(res.status_code, 200, res.get_json())
        body = res.get_json()
        self.assertEqual((body["rrule"], body["exdates"]), ("FREQ=WEEKLY;BYDAY=TH", ["2026-10-08T16:00:00+00:00"]))
        self.assertEqual(
            [o[0] for o in self.overrides(m["id"])], ["2026-10-22T16:00:00+00:00", "2026-10-29T16:00:00+00:00"]
        )

    def test_series_length_change_keeps_custom_override_length(self):
        m = self.weekly_wed()
        self.put_occ(m["id"], "2026-10-07T16:00:00Z", {"scope": "this", "end_at": "2026-10-07T16:30:00Z"})
        self.put_occ(m["id"], "2026-09-30T16:00:00Z", {"scope": "all", "end_at": "2026-09-30T18:00:00Z"})
        self.assertEqual(
            [o[1:3] for o in self.overrides(m["id"])], [("2026-10-07T16:00:00+00:00", "2026-10-07T16:30:00+00:00")]
        )

    def test_new_rule_drops_only_exceptions_it_no_longer_has(self):
        m = self._series_with_exceptions()
        self.put_occ(m["id"], "2026-09-30T16:00:00Z", {"scope": "all", "rrule": "FREQ=DAILY"})
        self.assertEqual(self.row(m["id"])["exdates"], ["2026-10-07T16:00:00+00:00"])
        self.assertEqual(len(self.overrides(m["id"])), 2)

        self.put_occ(m["id"], "2026-09-30T16:00:00Z", {"scope": "all", "rrule": "FREQ=DAILY;BYDAY=MO,TU,TH,FR"})
        self.assertEqual((self.row(m["id"])["exdates"], self.overrides(m["id"])), ([], []))

    def test_all_on_one_half_of_a_split_leaves_the_other(self):
        m = self.weekly_wed()
        new = self.put_occ(m["id"], "2026-10-14T16:00:00Z", {"scope": "following", "title": "Later"})
        old_before = self.row(m["id"])
        self.put_occ(
            new["id"],
            "2026-10-21T16:00:00Z",
            {"scope": "all", "title": "Renamed", "start_at": "2026-10-21T17:00:00Z", "end_at": "2026-10-21T18:00:00Z"},
        )
        self.assertEqual(self.row(m["id"]), old_before)
        self.assertEqual(
            [(e["start_at"], e["title"]) for e in self.events(end="2026-10-22T00:00:00Z")],
            [
                ("2026-09-30T16:00:00+00:00", "Standup"),
                ("2026-10-07T16:00:00+00:00", "Standup"),
                ("2026-10-14T17:00:00+00:00", "Renamed"),
                ("2026-10-21T17:00:00+00:00", "Renamed"),
            ],
        )

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
