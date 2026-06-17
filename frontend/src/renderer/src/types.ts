
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

export type FeatureData = {
    id: string,
    created_at: string | Date,
    updated_at: string | Date,
    project_id: string,
    name: string,
    notes_updated_at: string | Date
};

export class Feature {
    id: string;
    created_at: Date;
    updated_at: Date;
    project_id: string;
    name: string;
    notes_updated_at: Date;

    constructor(data: FeatureData) {
        this.id = data.id;
        this.created_at = new Date(data.created_at);
        this.updated_at = new Date(data.updated_at);
        this.project_id = data.project_id;
        this.name = data.name;
        this.notes_updated_at = new Date(data.notes_updated_at);
    }
}

export type ProjectData = {
    id: string,
    created_at: string | Date,
    updated_at: string | Date,
    title: string,
    description: string,
    type: string,
    status: string,
    notes_updated_at: string | Date
};

export class Project {
    id: string;
    created_at: Date;
    updated_at: Date;
    title: string;
    description: string;
    type: string;
    status: string;
    notes_updated_at: Date;

    constructor(data: ProjectData) {
        this.id = data.id;
        this.created_at = new Date(data.created_at);
        this.updated_at = new Date(data.updated_at);
        this.title = data.title;
        this.description = data.description;
        this.type = data.type;
        this.status = data.status;
        this.notes_updated_at = new Date(data.notes_updated_at);
    }

    async features(): Promise<Feature[]> {
        const raw: FeatureData[] = await window.api.apiGet(`/projects/${this.id}/features`);
        return raw.map(f => new Feature(f));
    }
}
