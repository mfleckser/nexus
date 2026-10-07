export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

// All day arithmetic below builds dates from local y/m/d/h/m fields rather
// than adding multiples of 86400000 ms, so it stays on local midnight (and on
// the same wall-clock time) across DST transitions, when a day is 23 or 25 h.

export const MINUTES_PER_DAY = 24 * 60;

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Midnight `n` calendar days after d's day.
export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Same wall-clock time, `n` calendar days later.
export const shiftDays = (d: Date, n: number): Date =>
    new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate() + n,
        d.getHours(),
        d.getMinutes(),
        d.getSeconds(),
        d.getMilliseconds(),
    );

// Midnight of the Sunday on or before d.
export const startOfWeek = (d: Date): Date => addDays(d, -d.getDay());

// Whole calendar days from a's day to b's day (negative if b is earlier).
export const calendarDaysBetween = (a: Date, b: Date): number =>
    Math.round(
        (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
            86400000,
    );

// Wall-clock minutes since local midnight.
export const minutesIntoDay = (d: Date): number => d.getHours() * 60 + d.getMinutes();

// `minutes` of wall-clock time into d's day (may roll into the next day).
export const atMinutes = (day: Date, minutes: number): Date =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);

// "9:05 AM"
export const formatTime = (d: Date): string => {
    const h = d.getHours();
    const m = d.getMinutes();
    const hh = h % 12 || 12;
    const mm = m.toString().padStart(2, "0");
    return `${hh}:${mm} ${h >= 12 ? "PM" : "AM"}`;
};

const pad = (n: number): string => String(n).padStart(2, "0");

// Value for an <input type="datetime-local">, in local time.
export function toDatetimeLocal(value: Date | string | null): string {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Values for <input type="date"> / <input type="time">, in local time.
export const toDateInput = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toTimeInput = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Local instant from date ("YYYY-MM-DD") and time ("HH:MM") input values;
// null while either is empty or out of range (e.g. mid-edit).
export function parseDateTimeInputs(dateStr: string, timeStr: string): Date | null {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    const tm = /^(\d{2}):(\d{2})$/.exec(timeStr);
    if (!dm || !tm) return null;
    const [y, mo, d, h, mi] = [Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2])];
    const result = new Date(y, mo, d, h, mi);
    // Reject overflow (Feb 30 → Mar 2, 25:00 → next day).
    if (result.getFullYear() !== y || result.getMonth() !== mo || result.getDate() !== d || h > 23 || mi > 59) {
        return null;
    }
    return result;
}

export function formatDueDisplay(value: Date | string | null): string {
    if (!value) return "No due date";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "No due date";
    return d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}
