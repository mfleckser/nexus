import { describe, expect, it } from "vitest";
import { agendaWindow, buildAgenda, type AgendaSection } from "./agenda";
import { event, task } from "./testRows";

// Thursday Nov 19 2026, 10:00 local (America/Los_Angeles, see vitest.config.ts).
const now = new Date(2026, 10, 19, 10, 0);
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);

const titles = (section: AgendaSection | undefined) =>
    section?.items.map((i) => (i.kind === "task" ? i.task.title : i.event.title));
const find = (sections: AgendaSection[], key: string) => sections.find((s) => s.key === key);

describe("agendaWindow", () => {
    it("runs from today's midnight through the 7th day after", () => {
        expect(agendaWindow(now)).toEqual({ start: new Date(2026, 10, 19), end: new Date(2026, 10, 27) });
    });
});

describe("buildAgenda", () => {
    it("always lists today, even when empty", () => {
        const sections = buildAgenda([], [], now);
        expect(sections.map((s) => s.key)).toEqual(["day:0"]);
        expect(sections[0]).toMatchObject({ title: "Today", subtitle: "Nov 19", items: [] });
    });

    it("buckets tasks by the shared due-date groups", () => {
        const sections = buildAgenda(
            [
                task({ title: "late", due_at: at(17, 9) }),
                task({ title: "today", due_at: at(19, 23, 30) }),
                task({ title: "tomorrow", due_at: at(20, 12) }),
                task({ title: "in a week", due_at: at(26, 8) }),
                task({ title: "later", due_at: at(30, 8) }),
                task({ title: "someday" }),
            ],
            [],
            now,
        );
        expect(sections.map((s) => [s.key, s.title])).toEqual([
            ["overdue", "Overdue"],
            ["day:0", "Today"],
            ["day:1", "Tomorrow"],
            ["day:7", "Thursday"],
            ["later", "Later"],
            ["noDueDate", "No due date"],
        ]);
        expect(titles(find(sections, "overdue"))).toEqual(["late"]);
        expect(titles(find(sections, "day:7"))).toEqual(["in a week"]);
        expect(find(sections, "later")?.collapsible).toBe(true);
        expect(find(sections, "overdue")?.tone).toBe("danger");
    });

    it("leaves out cancelled tasks and those of hidden projects", () => {
        const sections = buildAgenda(
            [
                task({ title: "cancelled", status: "cancelled", due_at: at(19, 12) }),
                task({ title: "hidden", project_id: "p1", due_at: at(19, 12) }),
                task({ title: "shown", project_id: "p2", due_at: at(19, 12) }),
            ],
            [],
            now,
            new Set(["p1"]),
        );
        expect(titles(find(sections, "day:0"))).toEqual(["shown"]);
    });

    it("keeps completed tasks on their day but drops completed overdue ones", () => {
        const sections = buildAgenda(
            [
                task({ title: "done today", status: "complete", due_at: at(19, 9) }),
                task({ title: "done late", status: "complete", due_at: at(18, 9) }),
            ],
            [],
            now,
        );
        expect(sections.map((s) => s.key)).toEqual(["day:0"]);
        expect(titles(sections[0])).toEqual(["done today"]);
    });

    it("orders a day's all-day events first, then events and tasks by time", () => {
        const sections = buildAgenda(
            [task({ title: "task 11", due_at: at(19, 11) })],
            [
                event({ title: "event 14", start_at: at(19, 14), end_at: at(19, 15) }),
                event({ title: "event 9", start_at: at(19, 9), end_at: at(19, 10) }),
                event({
                    title: "holiday",
                    all_day: true,
                    start_at: new Date("2026-11-19T08:00:00Z"),
                    end_at: new Date("2026-11-20T08:00:00Z"),
                }),
            ],
            now,
        );
        expect(titles(find(sections, "day:0"))).toEqual(["holiday", "event 9", "task 11", "event 14"]);
    });

    it("lists a multi-day event on every day it covers, after the first as a banner", () => {
        const sections = buildAgenda(
            [task({ title: "task", due_at: at(20, 8) })],
            [event({ title: "trip", start_at: at(19, 18), end_at: at(21, 12) })],
            now,
        );
        expect(titles(find(sections, "day:0"))).toEqual(["trip"]);
        expect(titles(find(sections, "day:1"))).toEqual(["trip", "task"]);
        expect(titles(find(sections, "day:2"))).toEqual(["trip"]);
        expect(find(sections, "day:3")).toBeUndefined();
    });

    it("places an all-day event on its own dates from another timezone", () => {
        // Nov 20 in New York: 05:00Z to 05:00Z, which is Nov 19 21:00 – Nov 20 21:00 here.
        const sections = buildAgenda(
            [],
            [
                event({
                    title: "ny day",
                    all_day: true,
                    timezone: "America/New_York",
                    start_at: new Date("2026-11-20T05:00:00Z"),
                    end_at: new Date("2026-11-21T05:00:00Z"),
                }),
            ],
            now,
        );
        expect(titles(find(sections, "day:0"))).toEqual([]);
        expect(titles(find(sections, "day:1"))).toEqual(["ny day"]);
    });

    it("sorts later tasks by due date", () => {
        const sections = buildAgenda(
            [task({ title: "dec 5", due_at: at(35, 9) }), task({ title: "nov 30", due_at: at(30, 9) })],
            [],
            now,
        );
        expect(titles(find(sections, "later"))).toEqual(["nov 30", "dec 5"]);
    });
});
