export const browserTimeZone = (): string =>
    Intl.DateTimeFormat().resolvedOptions().timeZone;

// Local y/m/d construction rather than millisecond arithmetic — DST-safe.
// Calendar.tsx's startOfWeek subtracts d.getDay()*86400000ms, which drifts an
// hour across a DST boundary; tolerable for a grid origin, not for a fetch window.
export const startOfDay = (d: Date): Date =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const addDays = (d: Date, n: number): Date =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
