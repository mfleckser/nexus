declare global {
    interface Window {
        api: {
            health: () => Promise<any>,
            apiGet: (path: string) => Promise<any>,
            apiPost: (path: string, body: any) => Promise<any>
            apiPut: (path: string, body: any) => Promise<any>
            apiDelete: (path: string) => Promise<any>
        }
    }
}

async function getTasks() {
    const raw = await window.api.apiGet("/tasks");
    return raw.map((t: any) => ({
        ...t,
        created_at: new Date(t.created_at),
        updated_at: new Date(t.updated_at),
        due_at: t.due_at ? new Date(t.due_at) : null,
    }));
}

function addTask(title: string, description: string | null, due_at: Date | null) {
    return window.api.apiPost("/tasks", {
        title: title,
        description: description,
        due_at: due_at
    })
}

function updateTask(id: string, data: any) {
    return window.api.apiPut(`/tasks/${id}`, data);
}

function deleteTask(id: string) {
    return window.api.apiDelete(`/tasks/${id}`)
}

export { getTasks, addTask, updateTask, deleteTask }