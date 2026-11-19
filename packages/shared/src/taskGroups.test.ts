import { describe, expect, it } from "vitest";
import { GroupableTask, groupTasks, taskGroup } from "./taskGroups";

// Runs in America/Los_Angeles (vitest.config.ts).
const local = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(y, mo - 1, d, h, mi);

// Wednesday 2026-09-30, 10:00 local.
const NOW = local(2026, 9, 30, 10);

const task = (due_at: Date | null, overrides: Partial<GroupableTask & { id: string }> = {}) => ({
    id: "t",
    status: "todo",
    due_at,
    project_id: null,
    created_at: local(2026, 9, 1),
    ...overrides,
});

describe("taskGroup", () => {
    it("sorts by calendar days to the due date, not hours", () => {
        expect(taskGroup(task(local(2026, 9, 29, 23, 59)), NOW)).toBe("overdue");
        expect(taskGroup(task(local(2026, 9, 30, 0, 0)), NOW)).toBe("today");
        expect(taskGroup(task(local(2026, 9, 30, 23, 59)), NOW)).toBe("today");
        expect(taskGroup(task(local(2026, 10, 1, 0, 1)), NOW)).toBe("thisWeek");
        expect(taskGroup(task(local(2026, 10, 7, 23, 59)), NOW)).toBe("thisWeek");
        expect(taskGroup(task(local(2026, 10, 8)), NOW)).toBe("future");
        expect(taskGroup(task(null), NOW)).toBe("noDueDate");
    });

    it("counts days across a DST change", () => {
        const beforeFallBack = local(2026, 10, 29, 12);
        expect(taskGroup(task(local(2026, 11, 5, 12)), beforeFallBack)).toBe("thisWeek");
        expect(taskGroup(task(local(2026, 11, 6, 0, 30)), beforeFallBack)).toBe("future");
    });

    it("drops completed tasks that are overdue or undated, keeps the rest", () => {
        const done = { status: "complete" };
        expect(taskGroup(task(local(2026, 9, 1), done), NOW)).toBeNull();
        expect(taskGroup(task(null, done), NOW)).toBeNull();
        expect(taskGroup(task(local(2026, 9, 30, 18), done), NOW)).toBe("today");
        expect(taskGroup(task(local(2026, 10, 3), done), NOW)).toBe("thisWeek");
        expect(taskGroup(task(local(2026, 12, 1), done), NOW)).toBe("future");
    });

    it("keeps other statuses, cancelled included", () => {
        expect(taskGroup(task(local(2026, 9, 1), { status: "cancelled" }), NOW)).toBe("overdue");
        expect(taskGroup(task(null, { status: "blocked" }), NOW)).toBe("noDueDate");
    });
});

describe("groupTasks", () => {
    it("buckets tasks oldest first within each group", () => {
        const newer = task(local(2026, 9, 30, 18), { id: "newer", created_at: local(2026, 9, 20) });
        const older = task(local(2026, 9, 30, 9), { id: "older", created_at: local(2026, 9, 2) });
        const undated = task(null, { id: "undated" });
        const groups = groupTasks([newer, undated, older], NOW);
        expect(groups.today.map((t) => t.id)).toEqual(["older", "newer"]);
        expect(groups.noDueDate.map((t) => t.id)).toEqual(["undated"]);
        expect(groups.overdue).toEqual([]);
        expect(groups.thisWeek).toEqual([]);
        expect(groups.future).toEqual([]);
    });

    it("leaves out tasks of hidden projects", () => {
        const hidden = task(null, { id: "hidden", project_id: "p-hidden" });
        const shown = task(null, { id: "shown", project_id: "p-shown" });
        const loose = task(null, { id: "loose" });
        const groups = groupTasks([hidden, shown, loose], NOW, new Set(["p-hidden"]));
        expect(groups.noDueDate.map((t) => t.id)).toEqual(["shown", "loose"]);
    });

    it("doesn't reorder the input", () => {
        const a = task(null, { id: "a", created_at: local(2026, 9, 5) });
        const b = task(null, { id: "b", created_at: local(2026, 9, 1) });
        const input = [a, b];
        groupTasks(input, NOW);
        expect(input.map((t) => t.id)).toEqual(["a", "b"]);
    });
});
