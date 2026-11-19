import type { CalendarEvent, Task } from "./types";

// Row builders for tests.

let nextId = 0;

export function task(fields: Partial<Task> = {}): Task {
    nextId++;
    return {
        id: `t${nextId}`,
        created_at: new Date(2026, 0, 1, 0, 0, nextId),
        updated_at: new Date(2026, 0, 1),
        title: `Task ${nextId}`,
        description: null,
        status: "todo",
        due_at: null,
        completed_at: null,
        project_id: null,
        feature_id: null,
        event_id: null,
        created_via: null,
        ...fields,
    };
}

export function event(fields: Partial<CalendarEvent> & Pick<CalendarEvent, "start_at" | "end_at">): CalendarEvent {
    nextId++;
    return {
        id: `e${nextId}`,
        created_at: new Date(2026, 0, 1),
        updated_at: new Date(2026, 0, 1),
        title: `Event ${nextId}`,
        description: null,
        all_day: false,
        category: null,
        timezone: "America/Los_Angeles",
        rrule: null,
        recurrence_end_at: null,
        exdates: [],
        recurring_event_id: null,
        original_start_at: null,
        created_via: null,
        ...fields,
    };
}
