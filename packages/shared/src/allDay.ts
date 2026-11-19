import { startOfDay } from "./dates";

// All-day events cover whole local days of their own timezone, stored as
// [midnight of the first day, midnight after the last day). The helpers here
// turn them into calendar days of the viewer — local midnights carrying the
// event's dates — so an all-day event stays on its dates when viewed from
// another timezone, and back (zonedMidnight) so edits stay in that timezone.

export type DayItem = { start_at: Date; end_at: Date; all_day: boolean | null; timezone: string };

const wallFormats = new Map<string, Intl.DateTimeFormat>();

// `instant`'s wall-clock fields in `timeZone`.
function wallParts(
    instant: Date,
    timeZone: string,
): Record<"year" | "month" | "day" | "hour" | "minute" | "second", number> {
    let fmt = wallFormats.get(timeZone);
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
        wallFormats.set(timeZone, fmt);
    }
    const parts = fmt.formatToParts(instant);
    const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
    return {
        year: part("year"),
        month: part("month"),
        day: part("day"),
        hour: part("hour"),
        minute: part("minute"),
        second: part("second"),
    };
}

// Local midnight of the calendar date `instant` falls on in `timeZone`.
export function wallDate(instant: Date, timeZone: string): Date {
    const { year, month, day } = wallParts(instant, timeZone);
    return new Date(year, month - 1, day);
}

// How far `timeZone`'s wall clock is ahead of UTC at `instant`, in ms.
function zoneOffset(instant: Date, timeZone: string): number {
    const p = wallParts(instant, timeZone);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
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
