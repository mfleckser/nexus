// Whole calendar days from a's day to b's day (negative if b is earlier).
export const calendarDaysBetween = (a: Date, b: Date): number =>
    Math.round(
        (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
            86400000,
    );
