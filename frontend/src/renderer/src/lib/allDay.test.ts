import { describe, expect, it } from "vitest";
import {
    allDayTimes,
    dayColumnAt,
    zonedMidnight,
    daySpan,
    DayItem,
    layoutDayBars,
    localDaySpan,
    wallDate,
} from "./allDay";

// Tests run in America/Los_Angeles (vitest.config.ts); DST ends 2026-11-01.
const local = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(y, mo - 1, d, h, mi);
const LA = "America/Los_Angeles";

type Item = DayItem & { id: string };

// All-day event over local days first..last of LA.
const allDay = (id: string, first: Date, last: Date, timezone = LA): Item => ({
    id,
    ...allDayTimes(first, last),
    all_day: true,
    timezone,
});

describe("wallDate", () => {
    it("reads the date in the given zone", () => {
        // 2026-10-31 02:00 UTC is still Oct 30 in LA.
        const instant = new Date("2026-10-31T02:00:00Z");
        expect(wallDate(instant, LA)).toEqual(local(2026, 10, 30));
        expect(wallDate(instant, "UTC")).toEqual(local(2026, 10, 31));
        expect(wallDate(instant, "Asia/Tokyo")).toEqual(local(2026, 10, 31));
    });
});

describe("daySpan", () => {
    it("covers an all-day event's dates, end exclusive, across DST", () => {
        const e = allDay("a", local(2026, 10, 30), local(2026, 11, 2));
        expect(e.end_at).toEqual(local(2026, 11, 3));
        expect(daySpan(e)).toEqual({ first: local(2026, 10, 30), last: local(2026, 11, 2) });
    });

    it("keeps an all-day event from another zone on its own dates", () => {
        // Nov 5 in New York: 2026-11-05T05:00Z .. 2026-11-06T05:00Z, which in
        // LA runs from 9 PM Nov 4 to 9 PM Nov 5.
        const e: DayItem = {
            start_at: new Date("2026-11-05T05:00:00Z"),
            end_at: new Date("2026-11-06T05:00:00Z"),
            all_day: true,
            timezone: "America/New_York",
        };
        expect(daySpan(e)).toEqual({ first: local(2026, 11, 5), last: local(2026, 11, 5) });
    });

    it("gives timed events their local days; a midnight end stays out", () => {
        const timed = (start: Date, end: Date): DayItem => ({
            start_at: start,
            end_at: end,
            all_day: null,
            timezone: LA,
        });
        expect(daySpan(timed(local(2026, 11, 5, 22), local(2026, 11, 7, 1)))).toEqual({
            first: local(2026, 11, 5),
            last: local(2026, 11, 7),
        });
        expect(daySpan(timed(local(2026, 11, 5, 22), local(2026, 11, 6)))).toEqual({
            first: local(2026, 11, 5),
            last: local(2026, 11, 5),
        });
        // Zero-length at midnight still covers its own day.
        expect(daySpan(timed(local(2026, 11, 6), local(2026, 11, 6))).last).toEqual(local(2026, 11, 6));
    });
});

describe("layoutDayBars", () => {
    const week = local(2026, 11, 1); // Sunday
    const rowsOf = (items: Item[]) =>
        Object.fromEntries(layoutDayBars(items, week, 7).bars.map((b) => [b.item.id, [b.startIndex, b.span, b.row]]));

    it("clips bars to the range and flags the clipped ends", () => {
        const { bars, rows } = layoutDayBars([allDay("a", local(2026, 10, 30), local(2026, 11, 2))], week, 7);
        expect(rows).toBe(1);
        expect(bars[0]).toMatchObject({ startIndex: 0, span: 2, row: 0, clippedStart: true, clippedEnd: false });
        const late = layoutDayBars([allDay("b", local(2026, 11, 6), local(2026, 11, 10))], week, 7).bars[0];
        expect(late).toMatchObject({ startIndex: 5, span: 2, clippedStart: false, clippedEnd: true });
    });

    it("drops items outside the range", () => {
        const items = [
            allDay("before", local(2026, 10, 25), local(2026, 10, 31)),
            allDay("after", local(2026, 11, 8), local(2026, 11, 8)),
        ];
        expect(layoutDayBars(items, week, 7)).toEqual({ bars: [], rows: 0 });
    });

    it("stacks overlapping bars and reuses free rows", () => {
        expect(
            rowsOf([
                allDay("short", local(2026, 11, 2), local(2026, 11, 2)),
                allDay("long", local(2026, 11, 2), local(2026, 11, 4)),
                allDay("mid", local(2026, 11, 3), local(2026, 11, 3)),
                allDay("later", local(2026, 11, 5), local(2026, 11, 5)),
            ]),
        ).toEqual({
            // Longer first on the same day.
            long: [1, 3, 0],
            short: [1, 1, 1],
            mid: [2, 1, 1],
            later: [4, 1, 0],
        });
    });

    it("lays out one-day range (day view)", () => {
        const { bars, rows } = layoutDayBars(
            [allDay("a", local(2026, 11, 2), local(2026, 11, 4)), allDay("b", local(2026, 11, 3), local(2026, 11, 3))],
            local(2026, 11, 3),
            1,
        );
        expect(rows).toBe(2);
        expect(bars.map((b) => [b.item.id, b.span, b.row, b.clippedStart, b.clippedEnd])).toEqual([
            ["a", 1, 0, true, true],
            ["b", 1, 1, false, false],
        ]);
    });
});

describe("localDaySpan", () => {
    it("leaves out a day reached only by a midnight end", () => {
        expect(localDaySpan(local(2026, 11, 1, 9), local(2026, 11, 3))).toEqual({
            first: local(2026, 11, 1),
            last: local(2026, 11, 2),
        });
    });
});

describe("dayColumnAt", () => {
    const rect = { left: 100, width: 700 };
    it("maps x to columns, unclamped outside the row", () => {
        expect(dayColumnAt(100, rect, 7)).toBe(0);
        expect(dayColumnAt(299, rect, 7)).toBe(1);
        expect(dayColumnAt(799, rect, 7)).toBe(6);
        expect(dayColumnAt(850, rect, 7)).toBe(7);
        expect(dayColumnAt(50, rect, 7)).toBe(-1);
    });
});

describe("zonedMidnight", () => {
    it("finds the instant a date begins in a zone, either side of DST", () => {
        expect(zonedMidnight(local(2026, 11, 5), "America/New_York").toISOString()).toBe("2026-11-05T05:00:00.000Z");
        expect(zonedMidnight(local(2026, 10, 30), "America/New_York").toISOString()).toBe("2026-10-30T04:00:00.000Z");
        // Nov 1: NY falls back at 2 AM, so its midnight is still EDT.
        expect(zonedMidnight(local(2026, 11, 1), "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z");
        expect(zonedMidnight(local(2026, 3, 8), LA).toISOString()).toBe("2026-03-08T08:00:00.000Z");
        expect(zonedMidnight(local(2026, 11, 5), "Asia/Tokyo").toISOString()).toBe("2026-11-04T15:00:00.000Z");
        expect(zonedMidnight(local(2026, 11, 5), "UTC").toISOString()).toBe("2026-11-05T00:00:00.000Z");
    });

    it("round-trips with wallDate and matches local midnights in the local zone", () => {
        const day = local(2026, 11, 2);
        expect(wallDate(zonedMidnight(day, "Asia/Tokyo"), "Asia/Tokyo")).toEqual(day);
        expect(zonedMidnight(day, LA)).toEqual(day);
    });

    it("anchors allDayTimes in a zone when given", () => {
        expect(allDayTimes(local(2026, 11, 5), local(2026, 11, 6), "America/New_York")).toEqual({
            start_at: new Date("2026-11-05T05:00:00Z"),
            end_at: new Date("2026-11-07T05:00:00Z"),
        });
    });
});
