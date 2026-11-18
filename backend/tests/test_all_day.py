"""All-day events: whole local days of the event's timezone, stored as
[midnight of the first day, midnight after the last day)."""

import unittest

from app_case import AppTestCase

LA = "America/Los_Angeles"
# Midnights in LA: PDT (UTC-7) until Sun 2026-11-01, PST (UTC-8) after.
OCT_30 = "2026-10-30T07:00:00Z"
OCT_31 = "2026-10-31T07:00:00Z"
NOV_1 = "2026-11-01T07:00:00Z"
NOV_2 = "2026-11-02T08:00:00Z"
NOV_3 = "2026-11-03T08:00:00Z"
MIDNIGHT_ERROR = "an all-day event must start and end at midnight in its timezone"


class AllDayTest(AppTestCase):
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
        # Sending the instance's all_day with it makes the series timed instead.
        self.put(
            occ,
            {"scope": "all", "all_day": False, "start_at": "2026-10-31T17:00:00Z", "end_at": "2026-10-31T18:00:00Z"},
        )
        self.assertFalse(any(e["all_day"] for e in self.events()))


if __name__ == "__main__":
    unittest.main()
