import { describe, expect, it } from "vitest";
import {
    addDays,
    atMinutes,
    calendarDaysBetween,
    formatTime,
    minutesIntoDay,
    parseDateTimeInputs,
    shiftDays,
    startOfDay,
    startOfWeek,
    toDateInput,
    toDatetimeLocal,
    toTimeInput,
} from "./time";

// Runs in America/Los_Angeles (vitest.config.ts): DST starts 2026-03-08,
// ends 2026-11-01.

const local = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(y, mo - 1, d, h, mi);

describe("time zone", () => {
    it("runs in a DST-observing zone", () => {
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Los_Angeles");
        expect(local(2026, 1, 15).getTimezoneOffset()).not.toBe(local(2026, 7, 15).getTimezoneOffset());
    });
});

describe("startOfDay / addDays", () => {
    it("drops the time of day", () => {
        expect(startOfDay(local(2026, 9, 30, 17, 45))).toEqual(local(2026, 9, 30));
    });

    it("stays on midnight across spring-forward and fall-back", () => {
        expect(addDays(local(2026, 3, 7), 1)).toEqual(local(2026, 3, 8));
        expect(addDays(local(2026, 3, 8), 1)).toEqual(local(2026, 3, 9));
        expect(addDays(local(2026, 10, 31), 1)).toEqual(local(2026, 11, 1));
        expect(addDays(local(2026, 11, 1), 1)).toEqual(local(2026, 11, 2));
        expect(addDays(local(2026, 11, 1), 7).getHours()).toBe(0);
    });

    it("goes backwards and across months", () => {
        expect(addDays(local(2026, 3, 1), -1)).toEqual(local(2026, 2, 28));
    });
});

describe("shiftDays", () => {
    it("keeps the wall-clock time across DST", () => {
        expect(shiftDays(local(2026, 3, 7, 9, 30), 1)).toEqual(local(2026, 3, 8, 9, 30));
        expect(shiftDays(local(2026, 11, 2, 22, 0), -2)).toEqual(local(2026, 10, 31, 22, 0));
    });
});

describe("startOfWeek", () => {
    it("returns the Sunday on or before", () => {
        expect(startOfWeek(local(2026, 10, 1, 15))).toEqual(local(2026, 9, 27));
        expect(startOfWeek(local(2026, 9, 27, 0, 1))).toEqual(local(2026, 9, 27));
    });

    it("lands on midnight in DST-transition weeks", () => {
        // Weeks containing the transitions; ms arithmetic would land on 23:00 / 01:00.
        expect(startOfWeek(local(2026, 3, 12, 8))).toEqual(local(2026, 3, 8));
        expect(startOfWeek(local(2026, 3, 8, 12))).toEqual(local(2026, 3, 8));
        expect(startOfWeek(local(2026, 11, 5, 8))).toEqual(local(2026, 11, 1));
        expect(startOfWeek(local(2026, 11, 8, 8))).toEqual(local(2026, 11, 8));
    });

    it("steps week to week on midnight through DST", () => {
        let week = startOfWeek(local(2026, 2, 25));
        for (let i = 0; i < 40; i++) {
            week = addDays(week, 7);
            expect(week.getDay()).toBe(0);
            expect(week.getHours()).toBe(0);
        }
    });
});

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

describe("minutesIntoDay / atMinutes", () => {
    it("uses wall-clock minutes", () => {
        expect(minutesIntoDay(local(2026, 3, 8, 9, 15))).toBe(555);
        expect(atMinutes(local(2026, 3, 8, 17), 555)).toEqual(local(2026, 3, 8, 9, 15));
        expect(atMinutes(local(2026, 11, 1), 24 * 60)).toEqual(local(2026, 11, 2));
    });
});

describe("formatting", () => {
    it("formats 12-hour times", () => {
        expect(formatTime(local(2026, 1, 1, 0, 5))).toBe("12:05 AM");
        expect(formatTime(local(2026, 1, 1, 12, 0))).toBe("12:00 PM");
        expect(formatTime(local(2026, 1, 1, 21, 30))).toBe("9:30 PM");
    });

    it("formats input values in local time", () => {
        const d = local(2026, 3, 8, 7, 5);
        expect(toDatetimeLocal(d)).toBe("2026-03-08T07:05");
        expect(toDatetimeLocal(null)).toBe("");
        expect(toDatetimeLocal("not a date")).toBe("");
        expect(toDateInput(d)).toBe("2026-03-08");
        expect(toTimeInput(d)).toBe("07:05");
    });
});

describe("parseDateTimeInputs", () => {
    it("parses valid local values", () => {
        expect(parseDateTimeInputs("2026-11-01", "09:30")).toEqual(local(2026, 11, 1, 9, 30));
    });

    it("rejects empty, malformed and overflowing values", () => {
        expect(parseDateTimeInputs("", "09:30")).toBeNull();
        expect(parseDateTimeInputs("2026-11-01", "")).toBeNull();
        expect(parseDateTimeInputs("2026-02-30", "09:30")).toBeNull();
        expect(parseDateTimeInputs("2026-11-01", "24:00")).toBeNull();
        expect(parseDateTimeInputs("2026-13-01", "09:30")).toBeNull();
    });
});
