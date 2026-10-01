export const browserTimeZone = (): string =>
    Intl.DateTimeFormat().resolvedOptions().timeZone;

// Local y/m/d construction rather than millisecond arithmetic — DST-safe.
// Calendar.tsx's startOfWeek subtracts d.getDay()*86400000ms, which drifts an
// hour across a DST boundary; tolerable for a grid origin, not for a fetch window.
export const startOfDay = (d: Date): Date =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const addDays = (d: Date, n: number): Date =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// "9:05 AM"
export const formatTime = (d: Date): string => {
    const h = d.getHours();
    const m = d.getMinutes();
    const hh = (h % 12) || 12;
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
