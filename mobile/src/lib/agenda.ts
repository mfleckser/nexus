import { addDays, calendarDaysBetween, daySpan, groupTasks, startOfDay } from "@nexus/shared";
import { dayHeading, formatMonthDay } from "./format";
import type { CalendarEvent, Task } from "./types";

// Days after today the agenda lists one by one: the shared "This Week" task
// group (due within 7 days).
export const UPCOMING_DAYS = 7;

// The window of events the agenda needs: today through the last upcoming day.
export function agendaWindow(now: Date): { start: Date; end: Date } {
    const start = startOfDay(now);
    return { start, end: addDays(start, UPCOMING_DAYS + 1) };
}

export type AgendaItem =
    | { kind: "event"; key: string; event: CalendarEvent }
    | { kind: "task"; key: string; task: Task };

export type AgendaSection = {
    key: string;
    title: string;
    // The day a day section lists (a local midnight), with its date as
    // the subtitle ("Nov 20").
    day: Date | null;
    subtitle: string | null;
    items: AgendaItem[];
    // Shown with its count only, until opened.
    collapsible: boolean;
    tone: "default" | "danger";
};

const taskItem = (task: Task): AgendaItem => ({ kind: "task", key: `task:${task.id}`, task });
const eventItem = (event: CalendarEvent): AgendaItem => ({ kind: "event", key: `event:${event.id}`, event });

// One day's items: all-day events (and timed ones carried over from an
// earlier day) first, then timed events and due tasks by time.
function dayItems(day: Date, events: readonly CalendarEvent[], tasks: readonly Task[]): AgendaItem[] {
    const banner: CalendarEvent[] = [];
    const timed: { at: number; item: AgendaItem }[] = [];
    for (const event of events) {
        const { first, last } = daySpan(event);
        if (calendarDaysBetween(first, day) < 0 || calendarDaysBetween(day, last) < 0) continue;
        if (event.all_day || calendarDaysBetween(first, day) > 0) banner.push(event);
        else timed.push({ at: event.start_at.getTime(), item: eventItem(event) });
    }
    for (const task of tasks) timed.push({ at: task.due_at?.getTime() ?? 0, item: taskItem(task) });
    timed.sort((a, b) => a.at - b.at);
    return [...banner.map(eventItem), ...timed.map((t) => t.item)];
}

// The agenda on `now`'s day: overdue tasks, today (always shown), each of
// the next UPCOMING_DAYS days that has anything, then later and undated tasks
// (collapsed). Tasks are bucketed by the shared due-date grouping; cancelled
// tasks and those of projects in `hiddenProjectIds` are left out.
export function buildAgenda(
    tasks: readonly Task[],
    events: readonly CalendarEvent[],
    now: Date,
    hiddenProjectIds: ReadonlySet<string> = new Set(),
): AgendaSection[] {
    const groups = groupTasks(
        tasks.filter((t) => t.status !== "cancelled"),
        now,
        hiddenProjectIds,
    );
    const sections: AgendaSection[] = [];
    const add = (key: string, title: string, items: AgendaItem[], extra: Partial<AgendaSection> = {}) =>
        sections.push({ key, title, items, day: null, subtitle: null, collapsible: false, tone: "default", ...extra });

    if (groups.overdue.length > 0) add("overdue", "Overdue", groups.overdue.map(taskItem), { tone: "danger" });

    const today = startOfDay(now);
    for (let offset = 0; offset <= UPCOMING_DAYS; offset++) {
        const day = addDays(today, offset);
        const due =
            offset === 0
                ? groups.today
                : groups.thisWeek.filter((t) => t.due_at && calendarDaysBetween(now, t.due_at) === offset);
        const items = dayItems(day, events, due);
        if (offset > 0 && items.length === 0) continue;
        add(`day:${offset}`, dayHeading(day, now), items, { day, subtitle: formatMonthDay(day) });
    }

    if (groups.future.length > 0) {
        const byDue = [...groups.future].sort((a, b) => (a.due_at?.getTime() ?? 0) - (b.due_at?.getTime() ?? 0));
        add("later", "Later", byDue.map(taskItem), { collapsible: true });
    }
    if (groups.noDueDate.length > 0) {
        add("noDueDate", "No due date", groups.noDueDate.map(taskItem), { collapsible: true });
    }
    return sections;
}
