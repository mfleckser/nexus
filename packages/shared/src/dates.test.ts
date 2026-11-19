import { describe, expect, it } from "vitest";
import { calendarDaysBetween } from "./dates";

// Runs in America/Los_Angeles (vitest.config.ts): DST starts 2026-03-08,
// ends 2026-11-01.

const local = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(y, mo - 1, d, h, mi);

describe("calendarDaysBetween", () => {
    it("counts whole days regardless of time of day", () => {
        expect(calendarDaysBetween(local(2026, 9, 30, 23, 59), local(2026, 10, 1, 0, 1))).toBe(1);
        expect(calendarDaysBetween(local(2026, 10, 1, 8), local(2026, 10, 1, 20))).toBe(0);
        expect(calendarDaysBetween(local(2026, 10, 3), local(2026, 10, 1))).toBe(-2);
    });

    it("is exact across 23 h and 25 h days", () => {
        expect(calendarDaysBetween(local(2026, 3, 7), local(2026, 3, 9))).toBe(2);
        expect(calendarDaysBetween(local(2026, 10, 31, 12), local(2026, 11, 2, 12))).toBe(2);
        expect(calendarDaysBetween(local(2026, 3, 1), local(2026, 11, 30))).toBe(274);
    });
});
