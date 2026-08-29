import { Feature, Project } from "@renderer/types";

async function getProjects(): Promise<Project[]> {
    const raw = await window.api.apiGet("/projects");
    return raw.map(p => ({
        ...p,
        created_at: new Date(p.created_at),
        updated_at: new Date(p.updated_at),
        notes_updated_at: new Date(p.notes_updated_at)
    }));
}

async function getNotes(project_id: string): Promise<string> {
    const raw = await window.api.apiGet(`/projects/${project_id}/notes`);
    return raw.notes ?? "";
}

function addProject(title: string, description: string, type: string) {
    return window.api.apiPost("/projects", {title, description, type});
}

function updateProject(id: string, data: any) {
    return window.api.apiPut(`/projects/${id}`, data);
}

function deleteProject(id: string) {
    return window.api.apiDelete(`/projects/${id}`)
}

async function getFeatures(project_id: string): Promise<Feature[]> {
    const raw = await window.api.apiGet(`/projects/${project_id}/features`)
    return raw.map(f => ({
        ...f,
        created_at: new Date(f.created_at),
        updated_at: new Date(f.updated_at),
        notes_updated_at: new Date(f.notes_updated_at)
    }));
}

function addFeature(project_id: string, name: string) {
    return window.api.apiPost(`/projects/${project_id}/features`, {name});
}

function deleteFeature(feature_id: string) {
    return window.api.apiDelete(`/features/${feature_id}`);
}

export {getProjects, getNotes, addProject, updateProject, deleteProject, getFeatures, addFeature, deleteFeature};
