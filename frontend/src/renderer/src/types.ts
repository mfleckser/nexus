
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
    category: string | null
};

export type NewEventDraft = {
    title: string;
    description: string;
    start_at: Date;
    duration: number;
    category: string;
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
    notes_updated_at: Date
};

