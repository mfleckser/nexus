
export type Task = {
    id: string,
    created_at: Date,
    updated_at: Date,
    title: string,
    description: string | null,
    status: string,
    due_at: Date | null,
    project_id: string | null,
    feature_id: string | null,
    event_id: string | null
};

export type Event = {
    id: string,
    created_at: Date,
    updated_at: Date,
    title: string,
    description: string | null,
    start_at: Date,
    end_at: Date,
    all_day: boolean,
    category: string | null,
    timezone: string,
    // RRULE body of the series (set on expanded instances and override rows).
    rrule: string | null,
    // Series master id; non-null iff this row is an occurrence of a recurring event.
    recurring_event_id: string | null,
    // The occurrence's original (unmodified) start; identifies it to the occurrence endpoints.
    original_start_at: Date | null
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
    top?: number;
};

export type Feature = {
    id: string,
    created_at: Date,
    updated_at: Date,
    project_id: string,
    name: string,
    notes_updated_at: Date
};

export type Project = {
    id: string,
    created_at: Date,
    updated_at: Date,
    title: string,
    description: string,
    type: string,
    status: string,
    show_tasks_in_main_view: boolean,
    notes_updated_at: Date
};

