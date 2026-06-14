
async function getTasks() {
    const raw = await window.api.apiGet("/tasks");
    return raw.map((t: any) => ({
        ...t,
        created_at: new Date(t.created_at),
        updated_at: new Date(t.updated_at),
        due_at: t.due_at ? new Date(t.due_at) : null,
    }));
}

function addTask(title: string, description: string | null, due_at: Date | null, project_id?: string, feature_id?: string) {
    return window.api.apiPost("/tasks", {
        title: title,
        description: description,
        due_at: due_at,
        project_id: project_id,
        feature_id: feature_id
    })
}

function updateTask(id: string, data: any) {
    return window.api.apiPut(`/tasks/${id}`, data);
}

function deleteTask(id: string) {
    return window.api.apiDelete(`/tasks/${id}`)
}

export { getTasks, addTask, updateTask, deleteTask }