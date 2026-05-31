
export type Task = {
    id: string,
    created_at: Date,
    updated_at: Date,
    title: string,
    description: string | null,
    status: string,
    due_at: Date | null,
    project_id: string | null,
    event_id: string | null
}

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
}
