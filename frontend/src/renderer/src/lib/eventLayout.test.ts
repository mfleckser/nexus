import { describe, expect, it } from "vitest";
import { layoutDays, overlapsRange, Timed } from "./eventLayout";

type Item = Timed & { id: string };

const local = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(y, mo - 1, d, h, mi);
// Items on 2026-09-30 (a Wednesday) by "HH:MM" strings.
const at = (hhmm: string): Date => {
    const [h, m] = hhmm.split(":").map(Number);
    return local(2026, 9, 30, h, m);
};
const item = (id: string, start: string, end: string): Item => ({ id, start_at: at(start), end_at: at(end) });

const layoutOneDay = (items: Item[]) => {
    const segments = layoutDays(items, local(2026, 9, 30), 1);
    return Object.fromEntries(segments.map((s) => [s.item.id, { column: s.column, columns: s.columns }]));
};

describe("layoutDays clusters", () => {
    it("gives a lone event the full width", () => {
        expect(layoutOneDay([item("a", "09:00", "10:00")])).toEqual({ a: { column: 0, columns: 1 } });
    });

    it("puts identical times side by side", () => {
        expect(layoutOneDay([item("a", "09:00", "10:00"), item("b", "09:00", "10:00")])).toEqual({
            a: { column: 0, columns: 2 },
            b: { column: 1, columns: 2 },
        });
    });

    it("splits containment, longer event first", () => {
        expect(layoutOneDay([item("inner", "10:00", "11:00"), item("outer", "09:00", "12:00")])).toEqual({
            outer: { column: 0, columns: 2 },
            inner: { column: 1, columns: 2 },
        });
    });

    it("reuses a freed column in an A/B/C chain", () => {
        // A overlaps B, B overlaps C, A and C don't: two columns, C back in A's.
        expect(
            layoutOneDay([item("a", "09:00", "10:00"), item("b", "09:30", "10:30"), item("c", "10:00", "11:00")]),
        ).toEqual({
            a: { column: 0, columns: 2 },
            b: { column: 1, columns: 2 },
            c: { column: 0, columns: 2 },
        });
    });

    it("keeps back-to-back events full width", () => {
        expect(layoutOneDay([item("a", "09:00", "10:00"), item("b", "10:00", "11:00")])).toEqual({
            a: { column: 0, columns: 1 },
            b: { column: 0, columns: 1 },
        });
    });

    it("sizes clusters independently", () => {
        expect(
            layoutOneDay([
                item("a", "09:00", "10:00"),
                item("b", "09:00", "10:00"),
                item("c", "09:00", "10:00"),
                item("d", "13:00", "14:00"),
            ]),
        ).toEqual({
            a: { column: 0, columns: 3 },
            b: { column: 1, columns: 3 },
            c: { column: 2, columns: 3 },
            d: { column: 0, columns: 1 },
        });
    });

    it("is symmetric: order of input doesn't matter", () => {
        const items = [item("a", "09:00", "11:00"), item("b", "10:00", "12:00"), item("c", "11:30", "13:00")];
        expect(layoutOneDay(items)).toEqual(layoutOneDay([...items].reverse()));
    });

    it("collides zero-length events at the same instant", () => {
        expect(layoutOneDay([item("a", "09:00", "09:00"), item("b", "09:00", "09:00")])).toEqual({
            a: { column: 0, columns: 2 },
            b: { column: 1, columns: 2 },
        });
    });
});

describe("layoutDays segments", () => {
    it("splits an event crossing midnight into clipped per-day segments", () => {
        const late: Item = { id: "late", start_at: at("22:00"), end_at: local(2026, 10, 1, 2, 0) };
        const segments = layoutDays([late], local(2026, 9, 30), 2);
        expect(segments).toHaveLength(2);
        expect(segments[0]).toMatchObject({
            dayIndex: 0,
            startMin: 22 * 60,
            endMin: 24 * 60,
            clippedStart: false,
            clippedEnd: true,
        });
        expect(segments[1]).toMatchObject({
            dayIndex: 1,
            dayStart: local(2026, 10, 1),
            startMin: 0,
            endMin: 120,
            clippedStart: true,
            clippedEnd: false,
        });
    });

    it("lays out a clipped segment against that day's events", () => {
        const late: Item = { id: "late", start_at: local(2026, 9, 29, 23), end_at: local(2026, 9, 30, 1, 30) };
        expect(layoutOneDay([late, item("early", "01:00", "02:00")])).toEqual({
            late: { column: 0, columns: 2 },
            early: { column: 1, columns: 2 },
        });
    });

    it("doesn't spill an event ending at midnight into the next day", () => {
        const evening: Item = { id: "e", start_at: at("20:00"), end_at: local(2026, 10, 1) };
        const segments = layoutDays([evening], local(2026, 9, 30), 2);
        expect(segments).toHaveLength(1);
        expect(segments[0]).toMatchObject({ dayIndex: 0, endMin: 24 * 60, clippedEnd: false });
    });

    it("covers every day of a multi-day event", () => {
        const trip: Item = { id: "trip", start_at: local(2026, 9, 27, 12), end_at: local(2026, 10, 1, 12) };
        const segments = layoutDays([trip], local(2026, 9, 27), 7);
        expect(segments.map((s) => [s.dayIndex, s.startMin, s.endMin])).toEqual([
            [0, 720, 1440],
            [1, 0, 1440],
            [2, 0, 1440],
            [3, 0, 1440],
            [4, 0, 720],
        ]);
    });

    it("uses wall-clock minutes on a DST day", () => {
        const morning: Item = { id: "m", start_at: local(2026, 3, 8, 9), end_at: local(2026, 3, 8, 10) };
        const [seg] = layoutDays([morning], local(2026, 3, 8), 1);
        expect([seg.startMin, seg.endMin]).toEqual([540, 600]);
    });
});

describe("overlapsRange", () => {
    const start = local(2026, 9, 27);
    const end = local(2026, 10, 4);

    it("includes events that started before the range", () => {
        expect(overlapsRange({ start_at: local(2026, 9, 26, 22), end_at: local(2026, 9, 27, 1) }, start, end)).toBe(
            true,
        );
    });

    it("excludes events touching the range only at its edges", () => {
        expect(overlapsRange({ start_at: local(2026, 9, 26, 22), end_at: start }, start, end)).toBe(false);
        expect(overlapsRange({ start_at: end, end_at: local(2026, 10, 4, 1) }, start, end)).toBe(false);
    });

    it("handles zero-length events by their instant", () => {
        expect(overlapsRange({ start_at: start, end_at: start }, start, end)).toBe(true);
        expect(overlapsRange({ start_at: end, end_at: end }, start, end)).toBe(false);
    });
});
