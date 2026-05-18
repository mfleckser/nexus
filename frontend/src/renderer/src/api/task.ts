declare global {
    interface Window {
        api: {
            health: () => Promise<any>,
            apiGet: (path: string) => Promise<any>,
            apiPost: (path: string, body: any) => Promise<any>
            apiPut: (path: string, body: any) => Promise<any>
        }
    }
}

function getTasks() {
    return window.api.apiGet("/tasks")
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

export { getTasks, addTask, updateTask }