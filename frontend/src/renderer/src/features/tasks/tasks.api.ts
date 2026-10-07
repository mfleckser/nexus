import { Task, TaskStatus } from "@renderer/types";
import { api, parseDate, parseNullableDate, Wire } from "@renderer/lib/api";

// Fields a PUT may change.
export type TaskUpdate = Partial<{
    title: string;
    description: string | null;
    due_at: Date | null;
    status: TaskStatus;
    project_id: string | null;
    feature_id: string | null;
}>;

function parseTask(t: Wire<Task>): Task {
    return {
        ...t,
        created_at: parseDate(t.created_at),
        updated_at: parseDate(t.updated_at),
        due_at: parseNullableDate(t.due_at),
        completed_at: parseNullableDate(t.completed_at),
    };
}

async function getTasks(): Promise<Task[]> {
    const raw = await api.get<Wire<Task>[]>("/tasks");
    return raw.map(parseTask);
}

function addTask(
    title: string,
    description: string | null,
    due_at: Date | null,
    project_id?: string,
    feature_id?: string,
): Promise<unknown> {
    return api.post("/tasks", {
        title: title,
        description: description,
        due_at: due_at,
        project_id: project_id,
        feature_id: feature_id,
    });
}

// Resolves to the updated row.
async function updateTask(id: string, data: TaskUpdate): Promise<Task> {
    return parseTask(await api.put<Wire<Task>>(`/tasks/${id}`, data));
}

function deleteTask(id: string): Promise<unknown> {
    return api.delete(`/tasks/${id}`);
}

export { getTasks, addTask, updateTask, deleteTask };
