"""All-day events: whole local days of the event's timezone, stored as
[midnight of the first day, midnight after the last day)."""

import copy
import unittest

from app_case import AppTestCase

LA = "America/Los_Angeles"
# Midnights in LA: PDT (UTC-7) until Sun 2026-11-01, PST (UTC-8) after.
OCT_30 = "2026-10-30T07:00:00Z"
OCT_31 = "2026-10-31T07:00:00Z"
NOV_1 = "2026-11-01T07:00:00Z"
NOV_2 = "2026-11-02T08:00:00Z"
NOV_3 = "2026-11-03T08:00:00Z"
NOV_4 = "2026-11-04T08:00:00Z"
NY = "America/New_York"
# Midnights in New York (EDT, UTC-4).
NY_OCT_30 = "2026-10-30T04:00:00Z"
NY_OCT_31 = "2026-10-31T04:00:00Z"
MIDNIGHT_ERROR = "an all-day event must start and end at midnight in its timezone"


class AllDayCase(AppTestCase):
    def create(self, status=201, **body):
        body.setdefault("title", "Trip")
        body.setdefault("timezone", LA)
        res = self.client.post("/api/events", json=body)
        self.assertEqual(res.status_code, status, res.get_json())
        return res.get_json()

    def put(self, path, body, status=200):
        res = self.client.put(f"/api/events/{path}", json=body)
        self.assertEqual(res.status_code, status, res.get_json())
        return res.get_json()

    def events(self, start="2026-10-28T00:00:00Z", end="2026-11-10T00:00:00Z"):
        res = self.client.get(f"/api/events?start={start}&end={end}")
        self.assertEqual(res.status_code, 200)
        return res.get_json()


class AllDayTest(AllDayCase):
    def test_create_multi_day(self):
        # Fri Oct 30 – Mon Nov 2, across the DST change.
        e = self.create(all_day=True, start_at=OCT_30, end_at=NOV_3)
        self.assertTrue(e["all_day"])
        [got] = self.events()
        self.assertEqual((got["start_at"], got["end_at"]), ("2026-10-30T07:00:00+00:00", "2026-11-03T08:00:00+00:00"))

    def test_create_rejects_non_midnight(self):
        for start, end, tz in [
            ("2026-10-30T08:00:00Z", OCT_31, LA),  # start 1 AM
            (OCT_30, "2026-10-31T06:00:00Z", LA),  # end 11 PM
            (OCT_30, OCT_31, "UTC"),  # LA midnights aren't UTC midnights
        ]:
            with self.subTest(start=start, end=end, tz=tz):
                err = self.create(status=400, all_day=True, start_at=start, end_at=end, timezone=tz)
                self.assertEqual(err["error"], MIDNIGHT_ERROR)
        self.assertEqual(self.db.rows, [])
        # Without all_day the same times are fine.
        self.create(start_at="2026-10-30T08:00:00Z", end_at=OCT_31)

    def test_update_toggles_and_checks(self):
        e = self.create(start_at="2026-10-30T16:00:00Z", end_at="2026-10-30T17:00:00Z")
        # Flagging all-day without moving to midnights is rejected...
        self.assertEqual(self.put(e["id"], {"all_day": True}, status=400)["error"], MIDNIGHT_ERROR)
        # ...with them it's accepted.
        e = self.put(e["id"], {"all_day": True, "start_at": OCT_30, "end_at": OCT_31})
        self.assertTrue(e["all_day"])
        # Moving an all-day event off midnight, or into a zone where its
        # times aren't midnight, is rejected; title edits don't re-check.
        self.put(e["id"], {"start_at": "2026-10-30T09:00:00Z"}, status=400)
        self.put(e["id"], {"timezone": "America/New_York"}, status=400)
        self.put(e["id"], {"title": "Renamed"})
        # Back to timed.
        e = self.put(e["id"], {"all_day": False, "start_at": "2026-10-30T16:00:00Z", "end_at": "2026-10-30T17:00:00Z"})
        self.assertFalse(e["all_day"])

    def test_daily_series_stays_on_midnight_across_dst(self):
        self.create(all_day=True, start_at=OCT_30, end_at=OCT_31, rrule="FREQ=DAILY;COUNT=5")
        spans = [(e["start_at"], e["end_at"]) for e in self.events()]
        self.assertEqual(
            spans,
            [
                ("2026-10-30T07:00:00+00:00", "2026-10-31T07:00:00+00:00"),
                ("2026-10-31T07:00:00+00:00", "2026-11-01T07:00:00+00:00"),
                # Sun Nov 1 is a 25-hour day.
                ("2026-11-01T07:00:00+00:00", "2026-11-02T08:00:00+00:00"),
                ("2026-11-02T08:00:00+00:00", "2026-11-03T08:00:00+00:00"),
                ("2026-11-03T08:00:00+00:00", "2026-11-04T08:00:00+00:00"),
            ],
        )
        self.assertTrue(all(e["all_day"] for e in self.events()))

    def test_occurrence_this_to_all_day(self):
        m = self.create(start_at="2026-10-30T16:00:00Z", end_at="2026-10-30T17:00:00Z", rrule="FREQ=DAILY;COUNT=3")
        occ = f"{m['id']}/occurrences/2026-10-31T16:00:00Z"
        self.put(occ, {"scope": "this", "all_day": True}, status=400)
        row = self.put(occ, {"scope": "this", "all_day": True, "start_at": OCT_31, "end_at": NOV_1})
        self.assertTrue(row["all_day"])
        flags = [(e["start_at"], e["all_day"]) for e in self.events()]
        self.assertEqual(
            flags,
            [
                ("2026-10-30T16:00:00+00:00", None),
                ("2026-10-31T07:00:00+00:00", True),
                ("2026-11-01T17:00:00+00:00", None),
            ],
        )

    def test_occurrence_all_converts_series(self):
        m = self.create(start_at="2026-10-30T16:00:00Z", end_at="2026-10-30T17:00:00Z", rrule="FREQ=DAILY;COUNT=3")
        self.put(
            f"{m['id']}/occurrences/2026-10-31T16:00:00Z",
            {"scope": "all", "all_day": True, "start_at": OCT_31, "end_at": NOV_1},
        )
        evs = self.events()
        self.assertEqual(
            [(e["start_at"], e["end_at"]) for e in evs],
            [
                ("2026-10-30T07:00:00+00:00", "2026-10-31T07:00:00+00:00"),
                ("2026-10-31T07:00:00+00:00", "2026-11-01T07:00:00+00:00"),
                ("2026-11-01T07:00:00+00:00", "2026-11-02T08:00:00+00:00"),
            ],
        )
        self.assertTrue(all(e["all_day"] for e in evs))

    def test_occurrence_series_shift_off_midnight_rejected(self):
        m = self.create(all_day=True, start_at=OCT_30, end_at=OCT_31, rrule="FREQ=DAILY;COUNT=3")
        # This occurrence was made timed; moving it by an hour for the whole
        # (still all-day) series would put the series off midnight.
        occ = f"{m['id']}/occurrences/{OCT_31}"
        self.put(
            occ,
            {"scope": "this", "all_day": False, "start_at": "2026-10-31T16:00:00Z", "end_at": "2026-10-31T17:00:00Z"},
        )
        self.put(
            occ, {"scope": "all", "start_at": "2026-10-31T17:00:00Z", "end_at": "2026-10-31T18:00:00Z"}, status=400
        )
        self.put(
            occ,
            {"scope": "following", "start_at": "2026-10-31T17:00:00Z", "end_at": "2026-10-31T18:00:00Z"},
            status=400,
        )
        # Sending the instance's all_day with it makes the series timed instead,
        # at the instance's new time (10-11 AM), not shifted from midnight by
        # the instance's move.
        self.put(
            occ,
            {"scope": "all", "all_day": False, "start_at": "2026-10-31T17:00:00Z", "end_at": "2026-10-31T18:00:00Z"},
        )
        evs = self.events()
        self.assertFalse(any(e["all_day"] for e in evs))
        self.assertEqual(
            [(e["start_at"], e["end_at"]) for e in evs],
            [
                ("2026-10-30T17:00:00+00:00", "2026-10-30T18:00:00+00:00"),
                ("2026-10-31T17:00:00+00:00", "2026-10-31T18:00:00+00:00"),
                ("2026-11-01T18:00:00+00:00", "2026-11-01T19:00:00+00:00"),
            ],
        )

    def test_all_day_override_moves_timed_series_to_all_day(self):
        m = self.create(start_at="2026-10-30T16:00:00Z", end_at="2026-10-30T17:00:00Z", rrule="FREQ=DAILY;COUNT=3")
        occ = f"{m['id']}/occurrences/2026-10-31T16:00:00Z"
        self.put(occ, {"scope": "this", "all_day": True, "start_at": OCT_31, "end_at": NOV_1})
        # Drag that all-day occurrence a day later for the whole series.
        self.put(occ, {"scope": "all", "all_day": True, "start_at": NOV_1, "end_at": NOV_2})
        evs = self.events()
        self.assertTrue(all(e["all_day"] for e in evs))
        self.assertEqual(
            [(e["start_at"], e["end_at"]) for e in evs],
            [
                ("2026-10-31T07:00:00+00:00", "2026-11-01T07:00:00+00:00"),
                ("2026-11-01T07:00:00+00:00", "2026-11-02T08:00:00+00:00"),
                ("2026-11-02T08:00:00+00:00", "2026-11-03T08:00:00+00:00"),
            ],
        )

    def test_moved_override_converted_for_series_lands_on_midnight(self):
        m = self.create(start_at="2026-10-30T16:00:00Z", end_at="2026-10-30T17:00:00Z", rrule="FREQ=DAILY;COUNT=3")
        occ = f"{m['id']}/occurrences/2026-10-31T16:00:00Z"
        # Moved to 10-11 AM, then made all-day for the whole series.
        self.put(occ, {"scope": "this", "start_at": "2026-10-31T17:00:00Z", "end_at": "2026-10-31T18:00:00Z"})
        self.put(occ, {"scope": "all", "all_day": True, "start_at": OCT_31, "end_at": NOV_1})
        evs = self.events()
        self.assertTrue(all(e["all_day"] for e in evs))
        self.assertEqual(evs[0]["start_at"], "2026-10-30T07:00:00+00:00")

    def test_timed_all_day_false_is_no_detail_change(self):
        # A timed series (all_day NULL) with an all-day override: a series
        # title edit that also sends all_day=false must leave the override all-day.
        m = self.create(start_at="2026-10-30T16:00:00Z", end_at="2026-10-30T17:00:00Z", rrule="FREQ=DAILY;COUNT=3")
        self.put(
            f"{m['id']}/occurrences/2026-10-31T16:00:00Z",
            {"scope": "this", "all_day": True, "start_at": OCT_31, "end_at": NOV_1},
        )
        self.put(f"{m['id']}/occurrences/2026-10-30T16:00:00Z", {"scope": "all", "title": "Renamed", "all_day": False})
        evs = self.events()
        self.assertEqual([e["title"] for e in evs], ["Renamed"] * 3)
        self.assertEqual([bool(e["all_day"]) for e in evs], [False, True, False])

    def test_all_day_override_back_to_series_times(self):
        m = self.create(start_at="2026-10-30T16:00:00Z", end_at="2026-10-30T17:00:00Z", rrule="FREQ=DAILY;COUNT=3")
        occ = f"{m['id']}/occurrences/2026-10-31T16:00:00Z"
        self.put(occ, {"scope": "this", "all_day": True, "start_at": OCT_31, "end_at": NOV_1})
        # Back to timed at the series' own 9-10 AM, for all / following.
        for scope in ("all", "following"):
            with self.subTest(scope=scope):
                self.put(occ, {"scope": "this", "all_day": True, "start_at": OCT_31, "end_at": NOV_1})
                self.put(
                    occ,
                    {
                        "scope": scope,
                        "all_day": False,
                        "start_at": "2026-10-31T16:00:00Z",
                        "end_at": "2026-10-31T17:00:00Z",
                    },
                )
                evs = self.events()
                self.assertEqual([bool(e["all_day"]) for e in evs], [False] * 3)
                self.assertEqual(evs[1]["start_at"], "2026-10-31T16:00:00+00:00")
                self.assertEqual(evs[1]["end_at"], "2026-10-31T17:00:00+00:00")

    def test_kind_change_on_same_instants_drops_overrides(self):
        # A legacy timed midnight-to-midnight series with a moved occurrence.
        m = self.create(start_at=OCT_30, end_at=OCT_31, rrule="FREQ=DAILY;COUNT=3")
        self.put(
            f"{m['id']}/occurrences/{OCT_31}",
            {"scope": "this", "start_at": "2026-10-31T17:00:00Z", "end_at": "2026-10-31T19:00:00Z"},
        )
        # Made all-day from another occurrence without moving it: the moved
        # 10 AM override can't become an all-day row off midnight.
        self.put(f"{m['id']}/occurrences/{OCT_30}", {"scope": "all", "all_day": True})
        evs = self.events()
        self.assertTrue(all(e["all_day"] for e in evs))
        self.assertEqual([e["start_at"] for e in evs], [f"{d[:-1]}+00:00" for d in (OCT_30, OCT_31, NOV_1)])


class AllDayRecurringEditTest(AllDayCase):
    """All-day rules combined with recurring edits that carry exceptions along
    (one apply_event_writes RPC per edit)."""

    def timed_daily(self, count=4):
        # 9-10 AM in LA from Fri Oct 30.
        return self.create(
            start_at="2026-10-30T16:00:00Z", end_at="2026-10-30T17:00:00Z", rrule=f"FREQ=DAILY;COUNT={count}"
        )

    def all_day_daily(self, count=5):
        return self.create(all_day=True, start_at=OCT_30, end_at=OCT_31, rrule=f"FREQ=DAILY;COUNT={count}")

    def cancel(self, master_id, start):
        res = self.client.delete(f"/api/events/{master_id}/occurrences/{start}?scope=this")
        self.assertEqual(res.status_code, 200, res.get_json())

    def spans(self, evs=None):
        return [(e["start_at"], e["end_at"], bool(e["all_day"])) for e in (evs or self.events())]

    def overrides(self):
        return [r for r in self.db.rows if r["recurring_event_id"]]

    def test_kind_change_drops_overrides_without_shifting_exdates(self):
        m = self.timed_daily()
        self.cancel(m["id"], "2026-11-02T17:00:00Z")
        occ = f"{m['id']}/occurrences/2026-10-31T16:00:00Z"
        self.put(
            occ,
            {"scope": "this", "title": "Moved", "start_at": "2026-10-31T18:00:00Z", "end_at": "2026-10-31T19:00:00Z"},
        )
        self.put(
            f"{m['id']}/occurrences/2026-10-30T16:00:00Z",
            {"scope": "all", "all_day": True, "start_at": OCT_30, "end_at": OCT_31},
        )
        # The override is dropped, not shifted onto a midnight; the 9 AM exdate
        # isn't shifted either and lines up with no all-day occurrence.
        self.assertEqual(self.overrides(), [])
        self.assertEqual(self.db.rows[0]["exdates"], [])
        evs = self.events()
        self.assertEqual([e["title"] for e in evs], ["Trip"] * 4)
        self.assertEqual(
            self.spans(evs),
            [
                ("2026-10-30T07:00:00+00:00", "2026-10-31T07:00:00+00:00", True),
                ("2026-10-31T07:00:00+00:00", "2026-11-01T07:00:00+00:00", True),
                ("2026-11-01T07:00:00+00:00", "2026-11-02T08:00:00+00:00", True),
                ("2026-11-02T08:00:00+00:00", "2026-11-03T08:00:00+00:00", True),
            ],
        )

    def test_kind_change_on_same_instants_keeps_exdates(self):
        m = self.create(start_at=OCT_30, end_at=OCT_31, rrule="FREQ=DAILY;COUNT=3")
        self.cancel(m["id"], NOV_1)
        self.put(f"{m['id']}/occurrences/{OCT_31}", {"scope": "this", "title": "Renamed"})
        self.put(f"{m['id']}/occurrences/{OCT_30}", {"scope": "all", "all_day": True})
        self.assertEqual(self.overrides(), [])
        self.assertEqual(self.db.rows[0]["exdates"], ["2026-11-01T07:00:00+00:00"])
        self.assertEqual(
            [e["start_at"] for e in self.events()], ["2026-10-30T07:00:00+00:00", "2026-10-31T07:00:00+00:00"]
        )

    def test_following_kind_change_keeps_earlier_exceptions(self):
        m = self.timed_daily()
        self.put(f"{m['id']}/occurrences/2026-10-30T16:00:00Z", {"scope": "this", "title": "Early"})
        self.cancel(m["id"], "2026-11-02T17:00:00Z")
        self.put(f"{m['id']}/occurrences/2026-11-01T17:00:00Z", {"scope": "this", "title": "Late"})
        self.put(
            f"{m['id']}/occurrences/2026-10-31T16:00:00Z",
            {"scope": "following", "all_day": True, "start_at": OCT_31, "end_at": NOV_1},
        )
        evs = self.events()
        self.assertEqual([e["title"] for e in evs], ["Early", "Trip", "Trip", "Trip"])
        self.assertEqual(
            self.spans(evs),
            [
                ("2026-10-30T16:00:00+00:00", "2026-10-30T17:00:00+00:00", False),
                ("2026-10-31T07:00:00+00:00", "2026-11-01T07:00:00+00:00", True),
                ("2026-11-01T07:00:00+00:00", "2026-11-02T08:00:00+00:00", True),
                ("2026-11-02T08:00:00+00:00", "2026-11-03T08:00:00+00:00", True),
            ],
        )
        # Only the old series' override is left.
        self.assertEqual([r["title"] for r in self.overrides()], ["Early"])

    def test_following_on_all_day_series_carries_exceptions(self):
        m = self.all_day_daily()
        self.cancel(m["id"], NOV_2)
        self.put(f"{m['id']}/occurrences/{NOV_1}", {"scope": "this", "title": "Special"})
        self.put(
            f"{m['id']}/occurrences/{NOV_3}",
            {"scope": "this", "all_day": False, "start_at": "2026-11-03T18:00:00Z", "end_at": "2026-11-03T19:00:00Z"},
        )
        # From Sat Oct 31 on, a day later (across the DST change).
        new = self.put(f"{m['id']}/occurrences/{OCT_31}", {"scope": "following", "start_at": NOV_1, "end_at": NOV_2})
        self.assertEqual(new["exdates"], ["2026-11-03T08:00:00+00:00"])
        evs = self.events()
        self.assertEqual([e["title"] for e in evs], ["Trip", "Trip", "Special", "Trip"])
        self.assertEqual(
            self.spans(evs),
            [
                ("2026-10-30T07:00:00+00:00", "2026-10-31T07:00:00+00:00", True),
                ("2026-11-01T07:00:00+00:00", "2026-11-02T08:00:00+00:00", True),
                ("2026-11-02T08:00:00+00:00", "2026-11-03T08:00:00+00:00", True),
                # The timed override keeps its 10 AM, a day later.
                ("2026-11-04T18:00:00+00:00", "2026-11-04T19:00:00+00:00", False),
            ],
        )
        self.assertEqual({r["recurring_event_id"] for r in self.overrides()}, {new["id"]})

    def test_all_day_override_moves_by_whole_days_with_timed_series(self):
        m = self.timed_daily(count=3)
        self.put(
            f"{m['id']}/occurrences/2026-10-31T16:00:00Z",
            {"scope": "this", "all_day": True, "start_at": OCT_31, "end_at": NOV_1},
        )
        # Series to 2-3 PM the same day: the all-day override stays put...
        self.put(
            f"{m['id']}/occurrences/2026-10-30T16:00:00Z",
            {"scope": "all", "start_at": "2026-10-30T21:00:00Z", "end_at": "2026-10-30T22:00:00Z"},
        )
        self.assertEqual(
            self.spans(),
            [
                ("2026-10-30T21:00:00+00:00", "2026-10-30T22:00:00+00:00", False),
                ("2026-10-31T07:00:00+00:00", "2026-11-01T07:00:00+00:00", True),
                ("2026-11-01T22:00:00+00:00", "2026-11-01T23:00:00+00:00", False),
            ],
        )
        # ...and a day later, it moves a whole day.
        self.put(
            f"{m['id']}/occurrences/2026-10-30T21:00:00Z",
            {"scope": "all", "start_at": "2026-10-31T21:00:00Z", "end_at": "2026-10-31T22:00:00Z"},
        )
        self.assertEqual(
            self.spans(),
            [
                ("2026-10-31T21:00:00+00:00", "2026-10-31T22:00:00+00:00", False),
                ("2026-11-01T07:00:00+00:00", "2026-11-02T08:00:00+00:00", True),
                ("2026-11-02T22:00:00+00:00", "2026-11-02T23:00:00+00:00", False),
            ],
        )

    def test_clicked_override_checked_before_writing(self):
        m = self.all_day_daily(count=3)
        occ = f"{m['id']}/occurrences/{OCT_31}"
        self.put(
            occ,
            {"scope": "this", "all_day": False, "start_at": "2026-10-31T16:00:00Z", "end_at": "2026-10-31T17:00:00Z"},
        )
        # Back to all-day for the series without moving it to midnight.
        before = copy.deepcopy(self.db.tables)
        for scope in ("all", "following"):
            with self.subTest(scope=scope):
                err = self.put(occ, {"scope": scope, "all_day": True, "title": "x"}, status=400)
                self.assertEqual(err["error"], MIDNIGHT_ERROR)
                self.assertEqual(self.db.tables, before)

    def test_cross_zone_all_day_series_carries_exceptions(self):
        m = self.all_day_daily(count=3)
        self.cancel(m["id"], OCT_31)
        self.put(f"{m['id']}/occurrences/{NOV_1}", {"scope": "this", "title": "Last"})
        occ = f"{m['id']}/occurrences/{OCT_30}"

        # A new zone where the times aren't midnight is rejected and writes nothing.
        before = copy.deepcopy(self.db.tables)
        self.db.queries.clear()
        self.put(occ, {"scope": "all", "timezone": NY}, status=400)
        self.put(occ, {"scope": "following", "timezone": NY}, status=400)
        self.assertEqual(self.db.tables, before)
        self.assertNotIn("rpc:apply_event_writes", self.db.queries)

        # With New York midnights, the exceptions follow in one RPC call.
        self.db.queries.clear()
        row = self.put(occ, {"scope": "all", "timezone": NY, "start_at": NY_OCT_30, "end_at": NY_OCT_31})
        self.assertEqual(self.db.queries.count("rpc:apply_event_writes"), 1)
        self.assertEqual((row["timezone"], row["exdates"]), (NY, ["2026-10-31T04:00:00+00:00"]))
        evs = self.events()
        self.assertEqual(
            [(e["start_at"], e["end_at"], e["title"], e["timezone"]) for e in evs],
            [
                ("2026-10-30T04:00:00+00:00", "2026-10-31T04:00:00+00:00", "Trip", NY),
                ("2026-11-01T04:00:00+00:00", "2026-11-02T05:00:00+00:00", "Last", NY),
            ],
        )
        self.assertTrue(all(e["all_day"] for e in evs))


if __name__ == "__main__":
    unittest.main()
