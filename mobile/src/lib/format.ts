import { calendarDaysBetween, daySpan } from "@nexus/shared";
import type { CalendarEvent } from "./types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "9:05 AM"
export function formatTime(d: Date): string {
    const h = d.getHours();
    const mm = d.getMinutes().toString().padStart(2, "0");
    return `${h % 12 || 12}:${mm} ${h >= 12 ? "PM" : "AM"}`;
}

// "Nov 20"
export const formatMonthDay = (d: Date): string => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

// "Fri, Nov 20"
export const formatShortDate = (d: Date): string => `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${formatMonthDay(d)}`;

// Heading for `day` seen from `now`: "Today", "Tomorrow", then the weekday.
export function dayHeading(day: Date, now: Date): string {
    const offset = calendarDaysBetween(now, day);
    if (offset === 0) return "Today";
    if (offset === 1) return "Tomorrow";
    return WEEKDAYS[day.getDay()];
}

// Day label for a picker: "Today", "Tomorrow", else "Fri, Nov 20".
export function dayLabel(day: Date, now: Date): string {
    const offset = calendarDaysBetween(now, day);
    if (offset === 0) return "Today";
    if (offset === 1) return "Tomorrow";
    return formatShortDate(day);
}

// An event's time as shown on `day` (a local midnight): "All day",
// "9:00 AM – 10:30 AM", or for a timed event spanning days "Until 2:00 PM" /
// "From 10:00 PM" / "All day" on the days in between.
export function eventTimeLabel(event: CalendarEvent, day: Date): string {
    if (event.all_day) return "All day";
    const { first, last } = daySpan(event);
    const startsToday = calendarDaysBetween(first, day) === 0;
    const endsToday = calendarDaysBetween(last, day) === 0;
    if (startsToday && endsToday) return `${formatTime(event.start_at)} – ${formatTime(event.end_at)}`;
    if (startsToday) return `From ${formatTime(event.start_at)}`;
    if (endsToday) return `Until ${formatTime(event.end_at)}`;
    return "All day";
}

// "Updated 9:05 AM" today, else "Updated Fri, Nov 20, 9:05 AM".
export function formatUpdatedAt(at: Date, now: Date): string {
    const time = formatTime(at);
    return calendarDaysBetween(at, now) === 0 ? `Updated ${time}` : `Updated ${formatShortDate(at)}, ${time}`;
}
