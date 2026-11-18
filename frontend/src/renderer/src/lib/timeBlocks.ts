// Task <-> event time blocks: tasks.event_id points at one event row (a plain
// event, a series master or an occurrence override).

import { calendarDaysBetween, formatTime } from "./time";

type LinkedTask = { event_id: string | null };
type EventRef = { id: string; recurring_event_id: string | null; start_at: Date; end_at: Date };

// Linked tasks keyed by event_id, keeping the input order.
export function tasksByEventId<T extends LinkedTask>(tasks: T[]): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const t of tasks) {
        if (t.event_id === null) continue;
        const list = map.get(t.event_id);
        if (list) list.push(t);
        else map.set(t.event_id, [t]);
    }
    return map;
}

// Tasks linked to this chip's event: to its own row, or (for an occurrence of
// a series) to the series master. Virtual occurrence ids never match a row.
export function tasksForEvent<T>(byEventId: Map<string, T[]>, event: Pick<EventRef, "id" | "recurring_event_id">): T[] {
    const own = byEventId.get(event.id) ?? [];
    const series = event.recurring_event_id ? (byEventId.get(event.recurring_event_id) ?? []) : [];
    return series.length ? [...own, ...series] : own;
}

// `now`'s minute rounded up to a quarter hour (seconds dropped): the default
// start of a new event or time block.
export function roundUpToQuarterHour(now: Date): Date {
    const start = new Date(now);
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
    return start;
}

// "Thu, Nov 19 · 2:00 PM – 3:00 PM" for a task's time block, from the loaded
// calendar events. "Repeating" when it is linked to a series master, and
// "Scheduled" when its event isn't in the loaded window. null = not linked.
export function timeBlockSummary(task: LinkedTask, events: EventRef[]): string | null {
    if (task.event_id === null) return null;
    const event = events.find((e) => e.id === task.event_id);
    if (event) {
        const day = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        const start = `${day(event.start_at)} · ${formatTime(event.start_at)}`;
        // Name the end day too when the block runs past midnight.
        const end = calendarDaysBetween(event.start_at, event.end_at) > 0 ? `${day(event.end_at)} · ` : "";
        return `${start} – ${end}${formatTime(event.end_at)}`;
    }
    if (events.some((e) => e.recurring_event_id === task.event_id)) return "Repeating";
    return "Scheduled";
}
