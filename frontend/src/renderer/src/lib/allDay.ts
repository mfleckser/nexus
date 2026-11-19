import { type DayItem, daySpan, localDaySpan, wallDate, zonedMidnight } from "@nexus/shared";
import { addDays, calendarDaysBetween, startOfDay } from "./time";

// All-day events cover whole local days of their own timezone. Mapping them
// to the viewer's days (daySpan, wallDate) and back (zonedMidnight) lives in
// @nexus/shared, so the phone app places them the same way.
export { daySpan, localDaySpan, wallDate, zonedMidnight };
export type { DayItem };

// Instants of an all-day event over local days first..last (inclusive): the
// viewer's local midnights, or with `timeZone`, that zone's.
export function allDayTimes(first: Date, last: Date, timeZone?: string): { start_at: Date; end_at: Date } {
    const [start, end] = [startOfDay(first), addDays(last, 1)];
    if (!timeZone) return { start_at: start, end_at: end };
    return { start_at: zonedMidnight(start, timeZone), end_at: zonedMidnight(end, timeZone) };
}

// Day column under clientX in a row of `days` equal columns spanning `rect`;
// unclamped (negative or >= days outside the row).
export const dayColumnAt = (clientX: number, rect: { left: number; width: number }, days: number): number =>
    Math.floor((days * (clientX - rect.left)) / rect.width);

// An item drawn as a horizontal bar over whole day columns (all-day row of
// the week view, a week row of the month view).
export type DayBar<T> = {
    item: T;
    // First column and number of columns covered, clipped to the range.
    startIndex: number;
    span: number;
    // Stacking row, 0 = top; overlapping bars never share a row.
    row: number;
    // The item continues before / after the range.
    clippedStart: boolean;
    clippedEnd: boolean;
};

// Bars for the items touching `days` day columns starting at local midnight
// `rangeStart`, each in the topmost row free over its columns. Earlier
// items go first and, on the same first day, longer ones; otherwise items
// keep their given order.
export function layoutDayBars<T extends DayItem>(
    items: T[],
    rangeStart: Date,
    days: number,
): { bars: DayBar<T>[]; rows: number } {
    const bars: DayBar<T>[] = [];
    for (const item of items) {
        const { first, last } = daySpan(item);
        const from = calendarDaysBetween(rangeStart, first);
        const to = calendarDaysBetween(rangeStart, last);
        if (to < 0 || from >= days) continue;
        const startIndex = Math.max(0, from);
        bars.push({
            item,
            startIndex,
            span: Math.min(days - 1, to) - startIndex + 1,
            row: 0,
            clippedStart: from < 0,
            clippedEnd: to >= days,
        });
    }
    bars.sort((a, b) => a.startIndex - b.startIndex || b.span - a.span);
    // Last column taken in each row so far.
    const rowEnds: number[] = [];
    for (const bar of bars) {
        let row = rowEnds.findIndex((end) => end < bar.startIndex);
        if (row === -1) row = rowEnds.length;
        rowEnds[row] = bar.startIndex + bar.span - 1;
        bar.row = row;
    }
    return { bars, rows: rowEnds.length };
}
