import { describe, expect, it } from "vitest";
import { defaultEventStart, eventCreateBody, LAST_SLOT, stepMinutes, taskCreateBody } from "./quickAdd";

const day = new Date(2026, 10, 20);

describe("stepMinutes", () => {
    it("moves by 15 minutes and wraps around the day", () => {
        expect(stepMinutes(600, 1)).toBe(615);
        expect(stepMinutes(0, -1)).toBe(LAST_SLOT);
        expect(stepMinutes(LAST_SLOT, 1)).toBe(0);
    });
});

describe("defaultEventStart", () => {
    it("is the next whole hour, capped at the last slot", () => {
        expect(defaultEventStart(new Date(2026, 10, 19, 10, 20))).toBe(11 * 60);
        expect(defaultEventStart(new Date(2026, 10, 19, 23, 10))).toBe(LAST_SLOT);
    });
});

describe("taskCreateBody", () => {
    it("trims the title and sets the due time on the day", () => {
        expect(taskCreateBody("  Call mom ", day, 23 * 60 + 30)).toEqual({
            title: "Call mom",
            due_at: new Date(2026, 10, 20, 23, 30).toISOString(),
        });
    });
});

describe("eventCreateBody", () => {
    const draft = { title: " Lunch ", day, allDay: false, startMinutes: 12 * 60, durationMinutes: 90 };

    it("starts a timed event on the day and runs for its length", () => {
        expect(eventCreateBody({ ...draft, timeZone: "America/Los_Angeles" })).toEqual({
            title: "Lunch",
            timezone: "America/Los_Angeles",
            all_day: false,
            start_at: "2026-11-20T20:00:00.000Z",
            end_at: "2026-11-20T21:30:00.000Z",
        });
    });

    it("covers the whole day in the event's zone when all day", () => {
        expect(eventCreateBody({ ...draft, allDay: true, timeZone: "America/New_York" })).toMatchObject({
            all_day: true,
            start_at: "2026-11-20T05:00:00.000Z",
            end_at: "2026-11-21T05:00:00.000Z",
        });
    });
});
