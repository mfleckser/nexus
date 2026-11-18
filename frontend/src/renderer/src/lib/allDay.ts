import { addDays, calendarDaysBetween, startOfDay } from "./time";

// All-day events cover whole local days of their own timezone, stored as
// [midnight of the first day, midnight after the last day). The helpers here
// turn them into calendar days of the viewer — local midnights carrying the
// event's dates — so an all-day event stays on its dates when viewed from
// another timezone, and back (zonedMidnight) so edits stay in that timezone.

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

const offsetFormats = new Map<string, Intl.DateTimeFormat>();

// How far `timeZone`'s wall clock is ahead of UTC at `instant`, in ms.
function zoneOffset(instant: Date, timeZone: string): number {
    let fmt = offsetFormats.get(timeZone);
    if (!fmt) {
        fmt = new Intl.DateTimeFormat("en-US", {
            timeZone,
            hourCycle: "h23",
            year: "numeric",
            month: "numeric",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
            second: "numeric",
        });
        offsetFormats.set(timeZone, fmt);
    }
    const parts = fmt.formatToParts(instant);
    const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
    const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

// The instant `day`'s date (a local midnight) begins in `timeZone`: the
// inverse of wallDate.
export function zonedMidnight(day: Date, timeZone: string): Date {
    const utc = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
    // Second pass corrects for an offset change between the guess and midnight.
    const guess = utc - zoneOffset(new Date(utc), timeZone);
    return new Date(utc - zoneOffset(new Date(guess), timeZone));
}

// Last instant of [start, end) (start itself if empty): an end exactly at
// midnight doesn't reach into that day.
const lastInstant = (start: Date, end: Date): Date => new Date(Math.max(start.getTime(), end.getTime() - 1));

// First and last (inclusive) local day [start, end) touches, as local midnights.
export const localDaySpan = (start: Date, end: Date): { first: Date; last: Date } => ({
    first: startOfDay(start),
    last: startOfDay(lastInstant(start, end)),
});

// First and last (inclusive) calendar day an item covers, as local midnights:
// an all-day event's dates in its own timezone, a timed event's local days.
export function daySpan(item: DayItem): { first: Date; last: Date } {
    if (!item.all_day) return localDaySpan(item.start_at, item.end_at);
    return {
        first: wallDate(item.start_at, item.timezone),
        last: wallDate(lastInstant(item.start_at, item.end_at), item.timezone),
    };
}

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
