import { describe, expect, it } from "vitest";
import {
    buildRrule,
    describeRrule,
    firstOccurrenceDay,
    matchPreset,
    maxUntilDate,
    parseRrule,
    presetLabel,
    presetRecurrence,
    Recurrence,
    sameRrule,
} from "./rrule";

// Runs in America/Los_Angeles (vitest.config.ts).
const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date => new Date(y, mo - 1, d, h, mi, s);

// Wednesday 2026-09-30, 10:00 local.
const START = local(2026, 9, 30, 10);

describe("parseRrule", () => {
    it("parses the picker subset", () => {
        expect(parseRrule("FREQ=DAILY", START)).toEqual({
            freq: "DAILY",
            interval: 1,
            byday: [],
            end: { type: "never" },
        });
        expect(parseRrule("RRULE:freq=weekly;interval=2;byday=fr,mo", START)).toEqual({
            freq: "WEEKLY",
            interval: 2,
            byday: ["MO", "FR"],
            end: { type: "never" },
        });
        expect(parseRrule("FREQ=MONTHLY;COUNT=5", START)?.end).toEqual({ type: "count", n: 5 });
    });

    it("defaults WEEKLY without BYDAY to the start's weekday", () => {
        expect(parseRrule("FREQ=WEEKLY", START)?.byday).toEqual(["WE"]);
    });

    it("returns null for rules outside the subset", () => {
        expect(parseRrule("", START)).toBeNull();
        expect(parseRrule("FREQ=HOURLY", START)).toBeNull();
        expect(parseRrule("FREQ=DAILY;BYDAY=MO", START)).toBeNull();
        expect(parseRrule("FREQ=WEEKLY;BYDAY=1MO", START)).toBeNull();
        expect(parseRrule("FREQ=DAILY;INTERVAL=0", START)).toBeNull();
        expect(parseRrule("FREQ=DAILY;COUNT=3;UNTIL=20261231", START)).toBeNull();
        expect(parseRrule("FREQ=DAILY;FREQ=WEEKLY", START)).toBeNull();
        expect(parseRrule("FREQ=MONTHLY;BYMONTHDAY=15", START)).toBeNull();
        expect(parseRrule("FREQ=WEEKLY;WKST=SU", START)).toBeNull();
    });

    it("accepts BYMONTHDAY / BYMONTH only when they match the start", () => {
        expect(parseRrule("FREQ=MONTHLY;BYMONTHDAY=30", START)?.freq).toBe("MONTHLY");
        expect(parseRrule("FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=30", START)?.freq).toBe("YEARLY");
    });

    it("reads UNTIL as the last local day with an occurrence", () => {
        expect(parseRrule("FREQ=DAILY;UNTIL=20261015", START)?.end).toEqual({
            type: "until",
            date: local(2026, 10, 15),
        });
        // 23:59:59 local on Oct 15 in UTC.
        expect(parseRrule("FREQ=DAILY;UNTIL=20261016T065959Z", START)?.end).toEqual({
            type: "until",
            date: local(2026, 10, 15),
        });
        // A series split writes UNTIL = split - 1s (before the start's time of
        // day on the split day), so the last occurrence is the day before.
        expect(parseRrule("FREQ=DAILY;UNTIL=20261015T165959Z", START)?.end).toEqual({
            type: "until",
            date: local(2026, 10, 14),
        });
    });
});

describe("buildRrule", () => {
    it("round-trips through parseRrule", () => {
        const recs: Recurrence[] = [
            { freq: "DAILY", interval: 3, byday: [], end: { type: "never" } },
            { freq: "WEEKLY", interval: 1, byday: ["MO", "WE", "FR"], end: { type: "count", n: 10 } },
            { freq: "MONTHLY", interval: 1, byday: [], end: { type: "until", date: local(2027, 3, 31) } },
        ];
        for (const rec of recs) expect(parseRrule(buildRrule(rec), START)).toEqual(rec);
    });

    it("writes UNTIL as the end of the local day in UTC across DST", () => {
        // Nov 1 is fall-back day; 23:59:59 PST = 07:59:59Z next day.
        const rec: Recurrence = {
            freq: "DAILY",
            interval: 1,
            byday: [],
            end: { type: "until", date: local(2026, 11, 1) },
        };
        expect(buildRrule(rec)).toBe("FREQ=DAILY;UNTIL=20261102T075959Z");
    });

    it("sorts BYDAY Monday-first", () => {
        expect(buildRrule({ freq: "WEEKLY", interval: 1, byday: ["SU", "MO"], end: { type: "never" } })).toBe(
            "FREQ=WEEKLY;BYDAY=MO,SU",
        );
    });
});

describe("sameRrule", () => {
    it("ignores order, case and equivalent forms", () => {
        expect(sameRrule("FREQ=WEEKLY;BYDAY=FR,MO", "byday=MO,FR;freq=weekly", START)).toBe(true);
        expect(sameRrule("FREQ=WEEKLY", "FREQ=WEEKLY;BYDAY=WE", START)).toBe(true);
        expect(sameRrule(null, null, START)).toBe(true);
        expect(sameRrule("FREQ=DAILY", null, START)).toBe(false);
        expect(sameRrule("FREQ=DAILY", "FREQ=DAILY;INTERVAL=2", START)).toBe(false);
    });

    it("falls back to exact comparison for custom rules", () => {
        expect(sameRrule("FREQ=HOURLY", "FREQ=HOURLY", START)).toBe(true);
        expect(sameRrule("FREQ=HOURLY", "FREQ=MINUTELY", START)).toBe(false);
    });
});

describe("presets", () => {
    it("maps presets to recurrences and back", () => {
        for (const preset of ["daily", "weekdays", "weekly", "monthly", "yearly"] as const) {
            const rec = presetRecurrence(preset, START);
            expect(rec).not.toBeNull();
            expect(matchPreset(rec!, START)).toBe(preset);
        }
        expect(presetRecurrence("none", START)).toBeNull();
    });

    it("labels presets from the start", () => {
        expect(presetLabel("weekly", START)).toBe("Weekly on Wednesday");
        expect(presetLabel("monthly", START)).toBe("Monthly on day 30 (skips shorter months)");
        expect(presetLabel("yearly", local(2028, 2, 29))).toBe("Yearly on Feb 29 (leap years only)");
    });
});

describe("describeRrule", () => {
    it("describes common rules", () => {
        expect(describeRrule(null, START)).toBe("Does not repeat");
        expect(describeRrule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", START)).toBe("Every weekday");
        expect(describeRrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE", START)).toBe("Every 2 weeks on Mon, Wed");
        expect(describeRrule("FREQ=DAILY;COUNT=1", START)).toBe("Daily, once");
        expect(describeRrule("FREQ=DAILY;UNTIL=20261015", START)).toBe("Daily, until Oct 15, 2026");
        expect(describeRrule("FREQ=SECONDLY", START)).toBe("Custom rule");
    });
});

describe("firstOccurrenceDay", () => {
    it("finds the first BYDAY on or after the start", () => {
        const rec: Recurrence = { freq: "WEEKLY", interval: 1, byday: ["MO"], end: { type: "never" } };
        expect(firstOccurrenceDay(rec, START)).toEqual(local(2026, 10, 5));
    });

    it("skips off-weeks for interval > 1", () => {
        // Week of Mon Sep 28 is week 0; Tuesday of week 0 has passed, so week 2.
        const rec: Recurrence = { freq: "WEEKLY", interval: 2, byday: ["TU"], end: { type: "never" } };
        expect(firstOccurrenceDay(rec, START)).toEqual(local(2026, 10, 13));
    });

    it("is the start day for other frequencies", () => {
        const rec: Recurrence = { freq: "MONTHLY", interval: 1, byday: [], end: { type: "never" } };
        expect(firstOccurrenceDay(rec, START)).toEqual(local(2026, 9, 30));
    });
});

describe("maxUntilDate", () => {
    it("stays inside the backend's 50-year limit", () => {
        expect(maxUntilDate(START)).toEqual(local(2076, 9, 28));
    });
});
