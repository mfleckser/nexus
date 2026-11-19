import { describe, expect, it } from "vitest";
import { daySpan, zonedMidnight } from "./allDay";

// Local times are America/Los_Angeles (vitest.config.ts).

describe("daySpan", () => {
    it("gives a timed event's local days", () => {
        const span = daySpan({
            start_at: new Date(2026, 10, 19, 22),
            end_at: new Date(2026, 10, 21, 0),
            all_day: false,
            timezone: "UTC",
        });
        expect(span).toEqual({ first: new Date(2026, 10, 19), last: new Date(2026, 10, 20) });
    });

    it("keeps an all-day event on its dates in its own zone", () => {
        const span = daySpan({
            start_at: new Date("2026-11-20T05:00:00Z"),
            end_at: new Date("2026-11-22T05:00:00Z"),
            all_day: true,
            timezone: "America/New_York",
        });
        expect(span).toEqual({ first: new Date(2026, 10, 20), last: new Date(2026, 10, 21) });
    });
});

describe("zonedMidnight", () => {
    it("is when the day begins in the zone", () => {
        expect(zonedMidnight(new Date(2026, 10, 20), "America/New_York").toISOString()).toBe(
            "2026-11-20T05:00:00.000Z",
        );
    });
});
