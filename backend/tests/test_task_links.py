"""Time-blocked tasks (tasks.event_id) keep their calendar link through scoped
edits of a recurring series."""

import unittest
from datetime import UTC, datetime
from unittest import mock

from app_case import AppTestCase

from app.services import event_service as es

LA = "America/Los_Angeles"
# Weekly Wednesdays 9:00-10:00 PDT from Wed 2026-09-30 (16:00Z).
SEP_30, OCT_7, OCT_14, OCT_21 = (f"2026-{d}T16:00:00Z" for d in ("09-30", "10-07", "10-14", "10-21"))
AN_HOUR_LATER = {"start_at": "2026-10-14T17:00:00Z", "end_at": "2026-10-14T18:00:00Z"}


def at(*args):
    """Freeze the service's "now" (the split rule depends on it)."""
    return mock.patch.object(es, "_now", return_value=datetime(*args, tzinfo=UTC))


class TaskLinkTest(AppTestCase):
    def weekly_wed(self, rrule="FREQ=WEEKLY;BYDAY=WE"):
        return self.request(
            "POST",
            "/api/events",
            {"title": "Standup", "start_at": SEP_30, "end_at": "2026-09-30T17:00:00Z", "timezone": LA, "rrule": rrule},
            status=201,
        )

    def put_occ(self, master_id, original_start, body):
        return self.request("PUT", f"/api/events/{master_id}/occurrences/{original_start}", body)

    def override(self, master_id, original_start, title):
        return self.put_occ(master_id, original_start, {"scope": "this", "title": title})

    def task_on(self, event_id):
        return self.request("POST", "/api/tasks", {"title": "T", "event_id": event_id}, status=201)["id"]

    def link(self, task_id):
        return self.request("GET", f"/api/tasks/{task_id}")["event_id"]

    def split(self, master_id, at_start=OCT_14, **body):
        """A "following" split at `at_start` (moved an hour later by default),
        returning (new master, the ops of its one RPC)."""
        with mock.patch.object(es, "_apply", wraps=es._apply) as spy:
            new = self.put_occ(master_id, at_start, {"scope": "following", **(body or AN_HOUR_LATER)})
        spy.assert_called_once()
        return new, spy.call_args.args[0]

    def events(self):
        return self.request("GET", "/api/events?start=2026-09-28T00:00:00Z&end=2026-11-30T00:00:00Z")

    def row(self, event_id):
        return next((r for r in self.db.rows if r["id"] == event_id), None)

    # -- "this and following" split that keeps the old master --

    def test_split_keeps_the_link_on_the_earlier_half_while_it_has_occurrences_ahead(self):
        m = self.weekly_wed()
        tid = self.task_on(m["id"])
        with at(2026, 10, 1):  # Oct 7 is still ahead, before the split
            _, ops = self.split(m["id"])
        self.assertNotIn("relink_tasks", [op["op"] for op in ops])
        self.assertEqual(self.link(tid), m["id"])

    def test_split_moves_the_link_to_the_later_half_when_the_earlier_one_is_past(self):
        m = self.weekly_wed()
        tid = self.task_on(m["id"])
        self.request("GET", "/api/tasks")  # warm the tasks cache
        with at(2026, 10, 10):  # the earlier half (Sep 30, Oct 7) is over
            new, ops = self.split(m["id"])
        self.assertIsNotNone(self.row(m["id"]))  # the old master survives, truncated
        self.assertEqual(self.link(tid), new["id"])
        # The cached list was cleared by the edit, not served stale.
        self.assertEqual([t["event_id"] for t in self.request("GET", "/api/tasks")], [new["id"]])
        # Same transaction: relinked after the insert of the new master.
        self.assertEqual(ops[0]["op"], "insert")
        self.assertIn({"op": "relink_tasks", "from": m["id"], "to": new["id"]}, ops[1:])
        # The task marker (matched by recurring_event_id) shows on the later
        # occurrences, not the earlier ones.
        owners = {e["start_at"][:10]: e["recurring_event_id"] for e in self.events()}
        self.assertEqual(owners["2026-10-07"], m["id"])
        self.assertEqual({owners[d] for d in ("2026-10-14", "2026-10-21", "2026-10-28")}, {new["id"]})

    def test_an_occurrence_in_progress_is_not_ahead(self):
        m = self.weekly_wed()
        tid = self.task_on(m["id"])
        with at(2026, 10, 7, 16, 30):  # during the Oct 7 occurrence
            new, _ = self.split(m["id"])
        self.assertEqual(self.link(tid), new["id"])

    def test_cancelled_occurrences_ahead_dont_keep_the_link_on_the_earlier_half(self):
        m = self.weekly_wed()
        self.request("DELETE", f"/api/events/{m['id']}/occurrences/{OCT_7}?scope=this")
        tid = self.task_on(m["id"])
        with at(2026, 10, 1):  # only the cancelled Oct 7 is left before the split
            new, _ = self.split(m["id"])
        self.assertIsNotNone(self.row(m["id"]))
        self.assertEqual(self.link(tid), new["id"])

    def test_an_earlier_occurrence_counts_at_its_overrides_time(self):
        for moved_to, now, keeps in (
            ("2026-10-20", (2026, 10, 10), True),  # Oct 7 moved ahead: still to come
            ("2026-09-29", (2026, 10, 1), False),  # Oct 7 moved into the past: none ahead
        ):
            with self.subTest(moved_to=moved_to):
                m = self.weekly_wed()
                times = {"start_at": f"{moved_to}T16:00:00Z", "end_at": f"{moved_to}T17:00:00Z"}
                self.put_occ(m["id"], OCT_7, {"scope": "this", **times})
                tid = self.task_on(m["id"])
                with at(*now):
                    new, _ = self.split(m["id"])
                self.assertEqual(self.link(tid), m["id"] if keeps else new["id"])

    def test_split_of_a_finished_series_moves_the_link_to_the_half_with_the_latest_occurrence(self):
        m = self.weekly_wed("FREQ=WEEKLY;BYDAY=WE;COUNT=4")  # Sep 30 .. Oct 21
        tid = self.task_on(m["id"])
        with at(2026, 12, 1):
            new, _ = self.split(m["id"])
        self.assertEqual(self.link(tid), new["id"])

    def test_split_leaves_override_links_with_their_occurrence(self):
        m = self.weekly_wed()
        before = self.override(m["id"], OCT_7, "Before")
        after = self.override(m["id"], OCT_21, "After")
        tasks = {
            "series": self.task_on(m["id"]),
            "before": self.task_on(before["id"]),
            "after": self.task_on(after["id"]),
        }
        with at(2026, 9, 1):
            new, _ = self.split(m["id"])
        self.assertEqual(
            {name: self.link(tid) for name, tid in tasks.items()},
            {"series": m["id"], "before": before["id"], "after": after["id"]},
        )
        # Each override row stays in the half holding its original start.
        self.assertEqual(self.row(before["id"])["recurring_event_id"], m["id"])
        self.assertEqual(self.row(after["id"])["recurring_event_id"], new["id"])

    def test_failed_split_leaves_the_link_on_the_series(self):
        m = self.weekly_wed()
        tid = self.task_on(m["id"])
        real_apply = es._apply

        def fail_after_relink(ops, result_id=None):
            self.db.fail_after_ops = [op["op"] for op in ops].index("relink_tasks") + 1
            return real_apply(ops, result_id)

        self.quiet_errors()
        with at(2026, 10, 10), mock.patch.object(es, "_apply", side_effect=fail_after_relink):
            self.request(
                "PUT", f"/api/events/{m['id']}/occurrences/{OCT_14}", {"scope": "following", **AN_HOUR_LATER}, 500
            )
        self.db.fail_after_ops = None
        self.assertEqual(self.link(tid), m["id"])
        self.assertEqual(len(self.db.rows), 1)

    # -- "all" edit that moves a series --

    def test_moving_the_series_keeps_override_links(self):
        m = self.weekly_wed()
        ov = self.override(m["id"], OCT_14, "Moved")
        tid = self.task_on(ov["id"])
        # Wednesdays -> Thursdays, an hour later.
        self.put_occ(
            m["id"], OCT_7, {"scope": "all", "start_at": "2026-10-08T17:00:00Z", "end_at": "2026-10-08T18:00:00Z"}
        )
        self.assertEqual(self.link(tid), ov["id"])
        row = self.row(ov["id"])
        self.assertEqual((row["original_start_at"], row["start_at"]), ("2026-10-15T17:00:00+00:00",) * 2)
        # The marker (matched by id) shows on the moved occurrence.
        shown = next(e for e in self.events() if e["id"] == ov["id"])
        self.assertEqual((shown["title"], shown["start_at"]), ("Moved", "2026-10-15T17:00:00+00:00"))

    # -- edits that drop overrides --

    def test_kind_change_moves_override_links_to_the_series(self):
        m = self.weekly_wed()
        ov = self.override(m["id"], OCT_14, "Moved")
        tid = self.task_on(ov["id"])
        all_day = {"all_day": True, "start_at": "2026-09-30T07:00:00Z", "end_at": "2026-10-01T07:00:00Z"}
        self.put_occ(m["id"], SEP_30, {"scope": "all", **all_day})
        self.assertIsNone(self.row(ov["id"]))
        self.assertEqual(self.link(tid), m["id"])

    def test_kind_change_split_moves_override_links_to_the_new_series(self):
        m = self.weekly_wed()
        ov = self.override(m["id"], OCT_21, "Moved")
        tid = self.task_on(ov["id"])
        with at(2026, 9, 1):
            new, _ = self.split(m["id"], all_day=True, start_at="2026-10-14T07:00:00Z", end_at="2026-10-15T07:00:00Z")
        self.assertIsNone(self.row(ov["id"]))
        self.assertEqual(self.link(tid), new["id"])

    def test_kind_change_that_also_changes_the_day_unlinks_overrides(self):
        m = self.weekly_wed()
        ov = self.override(m["id"], OCT_14, "Moved")
        tid = self.task_on(ov["id"])
        # All-day Thursdays: no occurrence on Wed Oct 14 any more.
        all_day = {"all_day": True, "start_at": "2026-10-01T07:00:00Z", "end_at": "2026-10-02T07:00:00Z"}
        self.put_occ(m["id"], SEP_30, {"scope": "all", **all_day})
        self.assertIsNone(self.link(tid))

    def test_an_occurrence_only_overlapping_the_overrides_day_doesnt_hold_it(self):
        m = self.weekly_wed()
        ov = self.override(m["id"], OCT_14, "Moved")
        tid = self.task_on(ov["id"])
        # All-day Tuesday-Wednesday: covers Wed Oct 14 but starts the day before.
        all_day = {"all_day": True, "start_at": "2026-09-29T07:00:00Z", "end_at": "2026-10-01T07:00:00Z"}
        self.put_occ(m["id"], SEP_30, {"scope": "all", **all_day})
        self.assertIsNone(self.link(tid))

    def test_new_rule_without_the_overrides_day_unlinks_it(self):
        m = self.weekly_wed()
        ov = self.override(m["id"], OCT_14, "Moved")
        tid = self.task_on(ov["id"])
        self.put_occ(m["id"], SEP_30, {"scope": "all", "rrule": "FREQ=WEEKLY;BYDAY=MO"})
        self.assertIsNone(self.row(ov["id"]))
        self.assertIsNone(self.link(tid))

    def test_clearing_the_rule_keeps_links_on_the_remaining_events_day(self):
        m = self.weekly_wed()
        first = self.override(m["id"], SEP_30, "First")
        later = self.override(m["id"], OCT_14, "Later")
        tasks = {"first": self.task_on(first["id"]), "later": self.task_on(later["id"])}
        self.request("PUT", f"/api/events/{m['id']}", {"rrule": None})
        self.assertEqual(self.row(m["id"])["start_at"], "2026-09-30T16:00:00+00:00")
        self.assertEqual({name: self.link(tid) for name, tid in tasks.items()}, {"first": m["id"], "later": None})

    def test_cancelling_an_occurrence_still_unlinks_its_tasks(self):
        m = self.weekly_wed()
        ov = self.override(m["id"], OCT_14, "Moved")
        tid = self.task_on(ov["id"])
        self.request("DELETE", f"/api/events/{m['id']}/occurrences/{OCT_14}?scope=this")
        self.assertIsNone(self.link(tid))


if __name__ == "__main__":
    unittest.main()
