import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import recurrence as rr  # noqa: E402

UTC = timezone.utc
LA = "America/Los_Angeles"


def utc(*args):
    return datetime(*args, tzinfo=UTC)


class ParseAndNormalizeTest(unittest.TestCase):
    start = utc(2026, 10, 5, 16)

    def test_canonicalizes(self):
        self.assertEqual(rr.normalize_rrule("rrule:freq=weekly;byday=mo,we", self.start, LA),
                         "FREQ=WEEKLY;BYDAY=MO,WE")

    def test_until_kept_in_utc_z_form(self):
        body = rr.normalize_rrule("FREQ=DAILY;UNTIL=20261231T235959Z", self.start, LA)
        self.assertEqual(body, "FREQ=DAILY;UNTIL=20261231T235959Z")

    def test_rejects_bad_input(self):
        bad = [
            "", "BYDAY=MO", "FREQ=SOMETIMES", "FREQ=DAILY;COUNT=0", "FREQ=DAILY;INTERVAL=x",
            "FREQ=DAILY;COUNT=3;UNTIL=20261231T000000Z", "FREQ=DAILY;UNTIL=20261231",
            "FREQ=DAILY;BOGUS=1", "FREQ=DAILY;UNTIL=20200101T000000Z", "FREQ", "FREQ=DAILY;FREQ=WEEKLY",
        ]
        for body in bad:
            with self.subTest(body=body), self.assertRaises(ValueError):
                rr.normalize_rrule(body, self.start, LA)

    def test_rejects_pathological_rules(self):
        bad = [
            "FREQ=HOURLY", "FREQ=SECONDLY", "FREQ=DAILY;COUNT=1001", "FREQ=DAILY;UNTIL=20770101T000000Z",
            "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", "FREQ=MONTHLY;BYMONTH=4,6;BYMONTHDAY=31",
            "FREQ=DAILY;BYSETPOS=1", "FREQ=DAILY;BYHOUR=1", "FREQ=DAILY;DTSTART=20261001T000000Z",
        ]
        for body in bad:
            with self.subTest(body=body), self.assertRaises(ValueError):
                rr.normalize_rrule(body, self.start, LA)

    def test_accepts_limits(self):
        rr.normalize_rrule("FREQ=DAILY;COUNT=1000", self.start, LA)
        rr.normalize_rrule("FREQ=DAILY;UNTIL=20751231T000000Z", self.start, LA)
        rr.normalize_rrule("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29", self.start, LA)  # leap days exist

    def test_rejects_unknown_timezone(self):
        with self.assertRaises(ValueError):
            rr.normalize_rrule("FREQ=DAILY", self.start, "Mars/Olympus")


class ExpandTest(unittest.TestCase):
    def test_dst_wall_clock_stable(self):
        # Weekly Mon 9:00 PT; DST ends Sun 2026-11-01.
        start = datetime(2026, 10, 19, 9, tzinfo=ZoneInfo(LA))
        occ = rr.expand("FREQ=WEEKLY", start, start + timedelta(hours=1), LA,
                        utc(2026, 10, 1), utc(2026, 11, 20))
        local = [s.astimezone(ZoneInfo(LA)) for s, _ in occ]
        self.assertEqual([d.day for d in local], [19, 26, 2, 9, 16])
        self.assertTrue(all(d.hour == 9 for d in local))
        self.assertEqual(occ[1][0], utc(2026, 10, 26, 16))  # PDT, UTC-7
        self.assertEqual(occ[2][0], utc(2026, 11, 2, 17))   # PST, UTC-8
        self.assertTrue(all(s.tzinfo == UTC for s, _ in occ))
        self.assertTrue(all(e - s == timedelta(hours=1) for s, e in occ))

    def test_until_inclusive(self):
        start = utc(2026, 10, 1, 12)
        occ = rr.expand("FREQ=DAILY;UNTIL=20261003T120000Z", start, start + timedelta(hours=1), "UTC",
                        utc(2026, 9, 1), utc(2027, 1, 1))
        self.assertEqual([s.day for s, _ in occ], [1, 2, 3])

    def test_count(self):
        start = utc(2026, 10, 1, 12)
        occ = rr.expand("FREQ=WEEKLY;COUNT=3", start, start + timedelta(hours=1), "UTC",
                        utc(2026, 9, 1), utc(2027, 1, 1))
        self.assertEqual([s for s, _ in occ], [start, start + timedelta(weeks=1), start + timedelta(weeks=2)])

    def test_interval(self):
        start = utc(2026, 10, 1, 12)
        occ = rr.expand("FREQ=DAILY;INTERVAL=3", start, start + timedelta(hours=1), "UTC",
                        utc(2026, 10, 1), utc(2026, 10, 11))
        self.assertEqual([s.day for s, _ in occ], [1, 4, 7, 10])

    def test_byday_weekly(self):
        start = utc(2026, 10, 5, 12)  # Monday
        occ = rr.expand("FREQ=WEEKLY;BYDAY=MO,WE", start, start + timedelta(hours=1), "UTC",
                        utc(2026, 10, 5), utc(2026, 10, 15))
        self.assertEqual([s.day for s, _ in occ], [5, 7, 12, 14])

    def test_exdates_and_override_starts_excluded(self):
        start = utc(2026, 10, 1, 12)
        excluded = [utc(2026, 10, 2, 12), datetime(2026, 10, 4, 5, tzinfo=ZoneInfo(LA))]  # = Oct 4 12:00Z
        occ = rr.expand("FREQ=DAILY", start, start + timedelta(hours=1), "UTC",
                        utc(2026, 10, 1), utc(2026, 10, 6), excluded)
        self.assertEqual([s.day for s, _ in occ], [1, 3, 5])

    def test_window_overlap(self):
        # 22:00-02:00 daily; window is Oct 3 00:00 - Oct 4 00:00 (half-open).
        start = utc(2026, 10, 1, 22)
        occ = rr.expand("FREQ=DAILY", start, start + timedelta(hours=4), "UTC",
                        utc(2026, 10, 3), utc(2026, 10, 4))
        # Oct 2 22:00 starts before the window but ends inside; Oct 3 22:00 starts inside.
        self.assertEqual([s for s, _ in occ], [utc(2026, 10, 2, 22), utc(2026, 10, 3, 22)])

    def test_window_edges_half_open(self):
        start = utc(2026, 10, 1, 10)
        # Occurrence ending exactly at window start, and one starting exactly at window end: both out.
        occ = rr.expand("FREQ=DAILY", start, start + timedelta(hours=2), "UTC",
                        utc(2026, 10, 2, 12), utc(2026, 10, 3, 10))
        self.assertEqual(occ, [])

    def test_dtstart_not_matching_rule_is_not_an_occurrence(self):
        start = utc(2026, 10, 6, 12)  # Tuesday
        self.assertEqual(rr.first_occurrence("FREQ=WEEKLY;BYDAY=MO,WE", start, "UTC"), utc(2026, 10, 7, 12))


class RecurrenceEndTest(unittest.TestCase):
    def test_unbounded(self):
        start = utc(2026, 10, 1, 12)
        self.assertIsNone(rr.recurrence_end("FREQ=DAILY", start, start + timedelta(hours=1), "UTC"))

    def test_count(self):
        start = utc(2026, 10, 1, 12)
        end = rr.recurrence_end("FREQ=DAILY;COUNT=5", start, start + timedelta(hours=1), "UTC")
        self.assertEqual(end, utc(2026, 10, 5, 13))

    def test_until(self):
        start = utc(2026, 10, 1, 12)
        end = rr.recurrence_end("FREQ=WEEKLY;UNTIL=20261020T000000Z", start, start + timedelta(hours=1), "UTC")
        self.assertEqual(end, utc(2026, 10, 15, 13))

    def test_until_across_dst(self):
        start = datetime(2026, 10, 19, 9, tzinfo=ZoneInfo(LA))
        end = rr.recurrence_end("FREQ=WEEKLY;COUNT=3", start, start + timedelta(hours=1), LA)
        self.assertEqual(end, utc(2026, 11, 2, 18))


class TruncateTest(unittest.TestCase):
    start = utc(2026, 10, 1, 12)

    def test_unbounded_split(self):
        body, remaining = rr.truncate("FREQ=DAILY;BYHOUR=12", self.start, "UTC", utc(2026, 10, 4, 12))
        self.assertEqual(body, "FREQ=DAILY;BYHOUR=12;UNTIL=20261004T115959Z")
        self.assertIsNone(remaining)
        occ = rr.expand(body, self.start, self.start + timedelta(hours=1), "UTC", utc(2026, 9, 1), utc(2027, 1, 1))
        self.assertEqual([s.day for s, _ in occ], [1, 2, 3])

    def test_count_split(self):
        split = utc(2026, 10, 4, 12)
        body, remaining = rr.truncate("FREQ=DAILY;COUNT=10", self.start, "UTC", split)
        self.assertEqual(body, "FREQ=DAILY;UNTIL=20261004T115959Z")
        self.assertEqual(remaining, 7)
        cont = rr.continuation_rule("FREQ=DAILY;COUNT=10", remaining)
        self.assertEqual(cont, "FREQ=DAILY;COUNT=7")
        old = rr.expand(body, self.start, self.start, "UTC", utc(2026, 9, 1), utc(2027, 1, 1))
        new = rr.expand(cont, split, split, "UTC", utc(2026, 9, 1), utc(2027, 1, 1))
        self.assertEqual(len(old) + len(new), 10)
        self.assertEqual(new[-1][0], utc(2026, 10, 10, 12))

    def test_until_split_keeps_old_until_for_continuation(self):
        body, remaining = rr.truncate("FREQ=DAILY;UNTIL=20261010T120000Z", self.start, "UTC", utc(2026, 10, 4, 12))
        self.assertEqual(body, "FREQ=DAILY;UNTIL=20261004T115959Z")
        self.assertIsNone(remaining)
        self.assertEqual(rr.continuation_rule("FREQ=DAILY;UNTIL=20261010T120000Z", remaining),
                         "FREQ=DAILY;UNTIL=20261010T120000Z")

    def test_split_at_first_occurrence_cuts_everything(self):
        body, remaining = rr.truncate("FREQ=DAILY;COUNT=4", self.start, "UTC", self.start)
        self.assertIsNone(body)
        self.assertEqual(remaining, 4)

    def test_truncated_recurrence_end(self):
        body, _ = rr.truncate("FREQ=DAILY", self.start, "UTC", utc(2026, 10, 4, 12))
        self.assertEqual(rr.recurrence_end(body, self.start, self.start + timedelta(hours=1), "UTC"),
                         utc(2026, 10, 3, 13))

    def test_is_occurrence(self):
        self.assertTrue(rr.is_occurrence("FREQ=DAILY", self.start, "UTC", utc(2026, 10, 3, 12)))
        self.assertFalse(rr.is_occurrence("FREQ=DAILY", self.start, "UTC", utc(2026, 10, 3, 13)))
        self.assertFalse(rr.is_occurrence("FREQ=DAILY", self.start, "UTC", utc(2026, 9, 30, 12)))

    def test_partition_instants(self):
        split = utc(2026, 10, 4, 12)
        before, after = rr.partition_instants([utc(2026, 10, 2, 12), split, utc(2026, 10, 9, 12)], split)
        self.assertEqual(before, [utc(2026, 10, 2, 12)])
        self.assertEqual(after, [split, utc(2026, 10, 9, 12)])



class MoveTest(unittest.TestCase):
    def test_wall_delta_and_shift_across_dst(self):
        # 9:00 PST instance moved to 10:00 PST = +1h wall clock.
        before, after = utc(2026, 11, 2, 17), utc(2026, 11, 2, 18)
        delta = rr.wall_delta(before, after, LA)
        self.assertEqual(delta, timedelta(hours=1))
        # Applied to a PDT series start (9:00 PDT) -> 10:00 PDT.
        self.assertEqual(rr.shift_wall(utc(2026, 10, 5, 16), delta, LA), utc(2026, 10, 5, 17))
        # A one-day move measured across the DST change is one wall-clock day, not 25h.
        self.assertEqual(rr.wall_delta(utc(2026, 10, 31, 16), utc(2026, 11, 1, 17), LA), timedelta(days=1))

    def test_shift_byday(self):
        wed, thu = utc(2026, 10, 7, 16), utc(2026, 10, 8, 16)
        self.assertEqual(rr.shift_rule_days("FREQ=WEEKLY;BYDAY=WE", wed, thu, LA), "FREQ=WEEKLY;BYDAY=TH")
        self.assertEqual(rr.shift_rule_days("FREQ=WEEKLY;BYDAY=MO,WE,SU", wed, thu, LA),
                         "FREQ=WEEKLY;BYDAY=TU,TH,MO")
        self.assertEqual(rr.shift_rule_days("FREQ=WEEKLY;BYDAY=MO", thu, wed, LA), "FREQ=WEEKLY;BYDAY=SU")
        self.assertEqual(rr.shift_rule_days("FREQ=WEEKLY;BYDAY=WE", wed, wed + timedelta(hours=3), LA),
                         "FREQ=WEEKLY;BYDAY=WE")

    def test_shift_uses_local_day(self):
        # 16:00Z Wed -> 06:00Z Thu is still Wed 23:00 in LA: no day change.
        self.assertEqual(rr.shift_rule_days("FREQ=WEEKLY;BYDAY=WE", utc(2026, 10, 7, 16), utc(2026, 10, 8, 6), LA),
                         "FREQ=WEEKLY;BYDAY=WE")

    def test_shift_ordinal_byday(self):
        # 2nd Tuesday (Oct 13) -> Wed Oct 21 is the 3rd Wednesday; last Friday stays "last".
        self.assertEqual(rr.shift_rule_days("FREQ=MONTHLY;BYDAY=2TU", utc(2026, 10, 13, 16), utc(2026, 10, 21, 16), LA),
                         "FREQ=MONTHLY;BYDAY=3WE")
        self.assertEqual(rr.shift_rule_days("FREQ=MONTHLY;BYDAY=-1FR", utc(2026, 10, 30, 16), utc(2026, 10, 29, 16), LA),
                         "FREQ=MONTHLY;BYDAY=-1TH")

    def test_shift_monthday_and_month(self):
        self.assertEqual(rr.shift_rule_days("FREQ=MONTHLY;BYMONTHDAY=5", utc(2026, 10, 5, 16), utc(2026, 10, 7, 16), LA),
                         "FREQ=MONTHLY;BYMONTHDAY=7")
        self.assertEqual(
            rr.shift_rule_days("FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=31", utc(2026, 10, 31, 16), utc(2026, 11, 1, 17), LA),
            "FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=1")

    def test_has_visible_occurrence(self):
        start = utc(2026, 10, 1, 12)
        both = [start, start + timedelta(days=1)]
        self.assertFalse(rr.has_visible_occurrence("FREQ=DAILY;COUNT=2", start, "UTC", both))
        self.assertTrue(rr.has_visible_occurrence("FREQ=DAILY;COUNT=3", start, "UTC", both))
        self.assertTrue(rr.has_visible_occurrence("FREQ=DAILY", start, "UTC", both))

    def test_recurrence_end_scan_is_capped(self):
        start = utc(2026, 10, 1, 12)
        with self.assertRaises(ValueError):
            rr.recurrence_end("FREQ=DAILY;BYMONTHDAY=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21;"
                              "UNTIL=29991231T000000Z", start, start + timedelta(hours=1), "UTC")


if __name__ == "__main__":
    unittest.main()
