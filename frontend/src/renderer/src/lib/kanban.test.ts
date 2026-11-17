import { describe, expect, it } from "vitest";
import { compareCompleted, fitCount } from "./kanban";

describe("compareCompleted", () => {
    const at = (iso: string | null) => ({ completed_at: iso ? new Date(iso) : null });

    it("orders most recently completed first, unstamped last", () => {
        const tasks = [
            { id: "old", ...at("2026-11-01T10:00:00Z") },
            { id: "none", ...at(null) },
            { id: "new", ...at("2026-11-15T10:00:00Z") },
            { id: "mid", ...at("2026-11-10T10:00:00Z") },
        ];
        expect(tasks.toSorted(compareCompleted).map((t) => t.id)).toEqual(["new", "mid", "old", "none"]);
    });

    it("treats two unstamped tasks as equal", () => {
        expect(compareCompleted(at(null), at(null))).toBe(0);
    });
});

describe("fitCount", () => {
    it("shows everything when it all fits, with no button", () => {
        expect(fitCount([30, 30, 30], 8, 20, 106)).toBe(3);
        expect(fitCount([], 8, 20, 100)).toBe(0);
    });

    it("reserves room for the button when some cards are cut", () => {
        // 30 + 8 + 30 = 68, + 8 + 20 button = 96 <= 100; a third card would not leave room.
        expect(fitCount([30, 30, 30, 30], 8, 20, 100)).toBe(2);
        expect(fitCount([30, 30, 30, 30], 8, 20, 95)).toBe(1);
    });

    it("always shows at least one card", () => {
        expect(fitCount([80, 30], 8, 20, 50)).toBe(1);
        expect(fitCount([30, 30], 8, 20, 0)).toBe(1);
    });
});
