import { describe, expect, it } from "vitest";
import { roundUpToQuarterHour, tasksByEventId, tasksForEvent, timeBlockSummary } from "./timeBlocks";

const task = (id: string, event_id: string | null) => ({ id, event_id });

describe("tasksByEventId / tasksForEvent", () => {
    const map = tasksByEventId([task("a", "e1"), task("b", null), task("c", "m1"), task("d", "e1")]);

    it("groups linked tasks by event, skipping unlinked ones", () => {
        expect(map.get("e1")?.map((t) => t.id)).toEqual(["a", "d"]);
        expect(map.get("m1")?.map((t) => t.id)).toEqual(["c"]);
        expect([...map.keys()]).toEqual(["e1", "m1"]);
    });

    it("matches a plain event by its own id", () => {
        expect(tasksForEvent(map, { id: "e1", recurring_event_id: null }).map((t) => t.id)).toEqual(["a", "d"]);
        expect(tasksForEvent(map, { id: "e2", recurring_event_id: null })).toEqual([]);
    });

    it("matches every occurrence of a linked series, overrides included", () => {
        expect(tasksForEvent(map, { id: "m1_1790000000", recurring_event_id: "m1" }).map((t) => t.id)).toEqual(["c"]);
        const linkedOverride = tasksByEventId([task("x", "o1"), task("y", "m1")]);
        expect(tasksForEvent(linkedOverride, { id: "o1", recurring_event_id: "m1" }).map((t) => t.id)).toEqual([
            "x",
            "y",
        ]);
    });
});

describe("roundUpToQuarterHour", () => {
    it("rounds the minute up to a quarter hour", () => {
        expect(roundUpToQuarterHour(new Date(2026, 10, 17, 9, 7, 30))).toEqual(new Date(2026, 10, 17, 9, 15));
        expect(roundUpToQuarterHour(new Date(2026, 10, 17, 9, 15, 40))).toEqual(new Date(2026, 10, 17, 9, 15));
        expect(roundUpToQuarterHour(new Date(2026, 10, 17, 23, 50))).toEqual(new Date(2026, 10, 18, 0, 0));
    });
});

describe("timeBlockSummary", () => {
    const event = {
        id: "e1",
        recurring_event_id: null,
        start_at: new Date(2026, 10, 19, 14, 0),
        end_at: new Date(2026, 10, 19, 15, 30),
    };
    const occurrence = { ...event, id: "m1_1790000000", recurring_event_id: "m1" };

    it("is null for an unlinked task", () => {
        expect(timeBlockSummary(task("a", null), [event])).toBeNull();
    });

    it("shows the linked event's day and times", () => {
        const summary = timeBlockSummary(task("a", "e1"), [occurrence, event]);
        expect(summary).toContain("2:00 PM – 3:30 PM");
        expect(summary).toContain("19");
    });

    it("names the end day of a block that runs past midnight", () => {
        const late = { ...event, start_at: new Date(2026, 10, 19, 22, 0), end_at: new Date(2026, 10, 20, 1, 0) };
        const summary = timeBlockSummary(task("a", "e1"), [late])!;
        expect(summary).toMatch(/19.*10:00 PM – .*20.*1:00 AM/);
    });

    it("says Repeating for a series link and Scheduled for an event outside the window", () => {
        expect(timeBlockSummary(task("a", "m1"), [occurrence])).toBe("Repeating");
        expect(timeBlockSummary(task("a", "gone"), [event])).toBe("Scheduled");
    });
});
