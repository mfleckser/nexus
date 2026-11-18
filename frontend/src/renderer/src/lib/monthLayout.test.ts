import { describe, expect, it } from "vitest";
import { allDayTimes, DayItem } from "./allDay";
import { isBarItem, layoutMonthWeek } from "./monthLayout";

// Tests run in America/Los_Angeles (vitest.config.ts).
const local = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(y, mo - 1, d, h, mi);
const LA = "America/Los_Angeles";
// Sunday.
const WEEK = local(2026, 11, 15);

type Item = DayItem & { id: string };

// All-day event over the week's days first..last (0 = Sunday).
const bar = (id: string, first: number, last: number): Item => ({
    id,
    ...allDayTimes(local(2026, 11, 15 + first), local(2026, 11, 15 + last)),
    all_day: true,
    timezone: LA,
});

// Single-day items per day of the week.
const days = (...counts: number[]): string[][] =>
    Array.from({ length: 7 }, (_, d) => Array.from({ length: counts[d] ?? 0 }, (_, i) => `d${d}-${i}`));

describe("isBarItem", () => {
    it("bars all-day and multi-day events, not single-day timed ones", () => {
        const timed = (start: Date, end: Date): DayItem => ({
            start_at: start,
            end_at: end,
            all_day: false,
            timezone: LA,
        });
        expect(isBarItem(bar("a", 0, 0))).toBe(true);
        expect(isBarItem(timed(local(2026, 11, 16, 9), local(2026, 11, 16, 10)))).toBe(false);
        // Ending exactly at midnight stays on one day.
        expect(isBarItem(timed(local(2026, 11, 16, 22), local(2026, 11, 17)))).toBe(false);
        expect(isBarItem(timed(local(2026, 11, 16, 22), local(2026, 11, 17, 1)))).toBe(true);
    });
});

describe("layoutMonthWeek", () => {
    it("puts each day's items below the bars covering it", () => {
        const { bars, days: out } = layoutMonthWeek([bar("a", 1, 3)], days(1, 2), WEEK, 4);
        expect(bars.map((b) => [b.item.id, b.startIndex, b.span, b.row])).toEqual([["a", 1, 3, 0]]);
        expect(out[0]).toEqual({ items: [{ item: "d0-0", row: 0 }], more: 0, moreRow: 1 });
        expect(out[1].items).toEqual([
            { item: "d1-0", row: 1 },
            { item: "d1-1", row: 2 },
        ]);
        expect(out[1].more).toBe(0);
    });

    it("keeps bars that fit above an overflowing day's +N more", () => {
        const { bars, days: out } = layoutMonthWeek([bar("a", 0, 3), bar("b", 1, 2)], days(0, 0, 2), WEEK, 3);
        expect(bars.map((b) => b.item.id)).toEqual(["a", "b"]);
        expect(out[2]).toEqual({ items: [], more: 2, moreRow: 2 });
    });

    it("keeps the last slot for +N more when a day overflows", () => {
        const { days: out } = layoutMonthWeek([], days(5, 3), WEEK, 3);
        expect(out[0].items.map((i) => i.row)).toEqual([0, 1]);
        expect(out[0]).toMatchObject({ more: 3, moreRow: 2 });
        // Exactly full: no overflow.
        expect(out[1].items).toHaveLength(3);
        expect(out[1].more).toBe(0);
    });

    it("hides a bar in an overflowing day's last slot and counts it on every day it covers", () => {
        // Bars in rows 0 and 1 of two slots; day 2 also has an item.
        const { bars, days: out } = layoutMonthWeek([bar("a", 0, 3), bar("b", 1, 2)], days(0, 0, 1), WEEK, 2);
        expect(bars.map((b) => b.item.id)).toEqual(["a"]);
        expect(out[1]).toEqual({ items: [], more: 1, moreRow: 1 });
        expect(out[2]).toEqual({ items: [], more: 2, moreRow: 1 });
        expect(out[3].more).toBe(0);
    });

    it("shows only +N more when a cell has one slot", () => {
        const { bars, days: out } = layoutMonthWeek([bar("a", 0, 0)], days(1, 1), WEEK, 1);
        expect(bars).toEqual([]);
        expect(out[0]).toEqual({ items: [], more: 2, moreRow: 0 });
        expect(out[1]).toEqual({ items: [{ item: "d1-0", row: 0 }], more: 0, moreRow: 1 });
    });

    it("clips bars to the week", () => {
        const { bars } = layoutMonthWeek([bar("a", -2, 1), bar("b", 5, 9)], days(), WEEK, 3);
        expect(bars.map((b) => [b.item.id, b.startIndex, b.span, b.clippedStart, b.clippedEnd])).toEqual([
            ["a", 0, 2, true, false],
            ["b", 5, 2, false, true],
        ]);
    });
});
