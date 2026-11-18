import { addDays, calendarDaysBetween, startOfDay } from "./time";

// All-day events cover whole local days of their own timezone, stored as
// [midnight of the first day, midnight after the last day). The helpers here
// turn them into calendar days of the viewer — local midnights carrying the
// event's dates — so an all-day event stays on its dates when viewed from
// another timezone.

export type DayItem = { start_at: Date; end_at: Date; all_day: boolean | null; timezone: string };

const dateFormats = new Map<string, Intl.DateTimeFormat>();

// Local midnight of the calendar date `instant` falls on in `timeZone`.
export function wallDate(instant: Date, timeZone: string): Date {
    let fmt = dateFormats.get(timeZone);
    if (!fmt) {
        fmt = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" });
        dateFormats.set(timeZone, fmt);
    }
    const parts = fmt.formatToParts(instant);
    const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
    return new Date(part("year"), part("month") - 1, part("day"));
}

// First and last (inclusive) calendar day an item covers, as local midnights:
// an all-day event's dates in its own timezone, a timed event's local days.
// An end exactly at midnight doesn't reach into that day.
export function daySpan(item: DayItem): { first: Date; last: Date } {
    const lastInstant = new Date(Math.max(item.start_at.getTime(), item.end_at.getTime() - 1));
    if (item.all_day) {
        return { first: wallDate(item.start_at, item.timezone), last: wallDate(lastInstant, item.timezone) };
    }
    return { first: startOfDay(item.start_at), last: startOfDay(lastInstant) };
}

// Instants of an all-day event over local days first..last (inclusive), in
// the viewer's timezone (sent with them).
export const allDayTimes = (first: Date, last: Date): { start_at: Date; end_at: Date } => ({
    start_at: startOfDay(first),
    end_at: addDays(last, 1),
});

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
