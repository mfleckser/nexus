import { describe, expect, it } from "vitest";
import { dayHeading, dayLabel, eventTimeLabel, formatTime, formatUpdatedAt } from "./format";
import { event } from "./testRows";

const now = new Date(2026, 10, 19, 10, 0);
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);

describe("formatTime", () => {
    it("uses a 12-hour clock", () => {
        expect(formatTime(at(19, 0, 5))).toBe("12:05 AM");
        expect(formatTime(at(19, 12, 0))).toBe("12:00 PM");
        expect(formatTime(at(19, 23, 30))).toBe("11:30 PM");
    });
});

describe("day names", () => {
    it("says Today and Tomorrow, then the weekday or date", () => {
        expect(dayHeading(at(19, 0), now)).toBe("Today");
        expect(dayHeading(at(20, 0), now)).toBe("Tomorrow");
        expect(dayHeading(at(21, 0), now)).toBe("Saturday");
        expect(dayLabel(at(21, 0), now)).toBe("Sat, Nov 21");
    });
});

describe("eventTimeLabel", () => {
    const day = (d: number) => new Date(2026, 10, d);

    it("shows a same-day event's range", () => {
        const e = event({ start_at: at(19, 9), end_at: at(19, 10, 30) });
        expect(eventTimeLabel(e, day(19))).toBe("9:00 AM – 10:30 AM");
    });

    it("shows the start, the middle and the end of a multi-day event", () => {
        const e = event({ start_at: at(19, 22), end_at: at(21, 14) });
        expect(eventTimeLabel(e, day(19))).toBe("From 10:00 PM");
        expect(eventTimeLabel(e, day(20))).toBe("All day");
        expect(eventTimeLabel(e, day(21))).toBe("Until 2:00 PM");
    });

    it("treats an end at midnight as the same day", () => {
        const e = event({ start_at: at(19, 23), end_at: at(20, 0) });
        expect(eventTimeLabel(e, day(19))).toBe("11:00 PM – 12:00 AM");
    });

    it("says All day for all-day events", () => {
        const e = event({ all_day: true, start_at: day(19), end_at: day(20) });
        expect(eventTimeLabel(e, day(19))).toBe("All day");
    });
});

describe("formatUpdatedAt", () => {
    it("drops the date for today", () => {
        expect(formatUpdatedAt(at(19, 9, 5), now)).toBe("Updated 9:05 AM");
        expect(formatUpdatedAt(at(18, 21, 0), now)).toBe("Updated Wed, Nov 18, 9:00 PM");
    });
});
