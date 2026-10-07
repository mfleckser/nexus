import { Feature, Project, ProjectStatus } from "@renderer/types";
import { api, parseDate, parseNullableDate, Wire } from "@renderer/lib/api";

// Fields a PUT may change.
export type ProjectUpdate = Partial<{
    title: string;
    description: string;
    type: string | null;
    status: ProjectStatus | null;
    show_tasks_in_main_view: boolean;
    notes: string;
}>;

function parseProject(p: Wire<Project>): Project {
    return {
        id: p.id,
        created_at: parseDate(p.created_at),
        updated_at: parseDate(p.updated_at),
        title: p.title,
        description: p.description,
        type: p.type,
        status: p.status,
        show_tasks_in_main_view: p.show_tasks_in_main_view,
        notes_updated_at: parseNullableDate(p.notes_updated_at),
    };
}

function parseFeature(f: Wire<Feature>): Feature {
    return {
        ...f,
        created_at: parseDate(f.created_at),
        updated_at: parseDate(f.updated_at),
        notes_updated_at: parseNullableDate(f.notes_updated_at),
    };
}

async function getProjects(): Promise<Project[]> {
    const raw = await api.get<Wire<Project>[]>("/projects");
    return raw.map(parseProject);
}

async function getNotes(project_id: string): Promise<string> {
    const raw = await api.get<{ notes: string | null }>(`/projects/${project_id}/notes`);
    return raw.notes ?? "";
}

function addProject(title: string, description: string, type: string | null): Promise<unknown> {
    return api.post("/projects", { title, description, type });
}

// Resolves to the updated row (the response also carries `notes`, which
// parseProject drops: notes live in their own per-project state).
async function updateProject(id: string, data: ProjectUpdate): Promise<Project> {
    return parseProject(await api.put<Wire<Project>>(`/projects/${id}`, data));
}

function deleteProject(id: string): Promise<unknown> {
    return api.delete(`/projects/${id}`);
}

async function getFeatures(project_id: string): Promise<Feature[]> {
    const raw = await api.get<Wire<Feature>[]>(`/projects/${project_id}/features`);
    return raw.map(parseFeature);
}

function addFeature(project_id: string, name: string): Promise<unknown> {
    return api.post(`/projects/${project_id}/features`, { name });
}

function deleteFeature(feature_id: string): Promise<unknown> {
    return api.delete(`/features/${feature_id}`);
}

export { getProjects, getNotes, addProject, updateProject, deleteProject, getFeatures, addFeature, deleteFeature };
