// Row types mirror backend/supabase/migrations. created_at / updated_at (and
// tasks.status) are nullable in the schema but always filled by their
// defaults/triggers, so they're typed non-null here.

export type TaskStatus = "todo" | "active" | "complete" | "cancelled";

export type Task = {
    id: string;
    created_at: Date;
    updated_at: Date;
    title: string;
    description: string | null;
    status: TaskStatus;
    due_at: Date | null;
    // Set by the backend when status becomes "complete".
    completed_at: Date | null;
    project_id: string | null;
    feature_id: string | null;
    event_id: string | null;
};

export type CalendarEvent = {
    id: string;
    created_at: Date;
    updated_at: Date;
    title: string;
    description: string | null;
    start_at: Date;
    end_at: Date;
    all_day: boolean | null;
    category: string | null;
    timezone: string;
    // RRULE body of the series (set on expanded instances and override rows).
    rrule: string | null;
    // Series master id; non-null iff this row is an occurrence of a recurring event.
    recurring_event_id: string | null;
    // The occurrence's original (unmodified) start; identifies it to the occurrence endpoints.
    original_start_at: Date | null;
};

export type RecurrenceScope = "this" | "following" | "all";

export type DateRange = {
    start: Date;
    end: Date;
};

export type NewEventDraft = {
    title: string;
    description: string;
    start_at: Date;
    duration: number;
    category: string;
    rrule?: string | null;
};

export type Feature = {
    id: string;
    created_at: Date;
    updated_at: Date;
    project_id: string;
    name: string;
    notes_updated_at: Date | null;
};

export type ProjectStatus = "planning" | "active" | "paused" | "complete" | "archived";

export type Project = {
    id: string;
    created_at: Date;
    updated_at: Date;
    title: string;
    description: string;
    type: string | null;
    status: ProjectStatus | null;
    show_tasks_in_main_view: boolean;
    // null until the notes are first edited.
    notes_updated_at: Date | null;
};
