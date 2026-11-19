import type { Event as ApiEvent, Task as ApiTask } from "@nexus/shared";

// API rows with their timestamps parsed into Dates.

export type Task = Omit<ApiTask, "created_at" | "updated_at" | "due_at" | "completed_at"> & {
    created_at: Date;
    updated_at: Date;
    due_at: Date | null;
    completed_at: Date | null;
};

export type CalendarEvent = Omit<ApiEvent, "created_at" | "updated_at" | "start_at" | "end_at"> & {
    created_at: Date;
    updated_at: Date;
    start_at: Date;
    end_at: Date;
};

const nullableDate = (value: string | null): Date | null => (value ? new Date(value) : null);

export const parseTask = (t: ApiTask): Task => ({
    ...t,
    created_at: new Date(t.created_at),
    updated_at: new Date(t.updated_at),
    due_at: nullableDate(t.due_at),
    completed_at: nullableDate(t.completed_at),
});

export const parseEvent = (e: ApiEvent): CalendarEvent => ({
    ...e,
    created_at: new Date(e.created_at),
    updated_at: new Date(e.updated_at),
    start_at: new Date(e.start_at),
    end_at: new Date(e.end_at),
});
