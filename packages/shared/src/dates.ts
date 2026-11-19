// Day arithmetic builds dates from local y/m/d fields rather than adding
// multiples of 86400000 ms, so it stays on local midnight across DST
// transitions, when a day is 23 or 25 h.

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Midnight `n` calendar days after d's day.
export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Whole calendar days from a's day to b's day (negative if b is earlier).
export const calendarDaysBetween = (a: Date, b: Date): number =>
    Math.round(
        (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
            86400000,
    );
