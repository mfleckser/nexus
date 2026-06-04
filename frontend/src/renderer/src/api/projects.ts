import { Project } from "@renderer/types";

async function getProjects(): Promise<Project[]> {
    const raw = await window.api.apiGet("/projects");
    return raw.map(p => ({
        ...p,
        created_at: new Date(p.created_at),
        updated_at: new Date(p.updated_at),
        notes_updated_at: new Date(p.notes_updated_at)
    }));
}

function addProject(title: string, description: string, type: string) {
    return window.api.apiPost("/projects", {title, description, type});
}

export {getProjects, addProject};
