import { Project } from "@renderer/types";

async function getProjects(): Promise<Project[]> {
    const raw = await window.api.apiGet("/projects");
    return raw.map(p => new Project(p));
}

function addProject(title: string, description: string, type: string) {
    return window.api.apiPost("/projects", {title, description, type});
}

function deleteProject(id: string) {
    return window.api.apiDelete(`/projects/${id}`)
}

export {getProjects, addProject, deleteProject};
