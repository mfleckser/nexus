import type { Task as ApiTask } from "@nexus/shared";
import { Task, TaskStatus } from "@renderer/types";
import { api, parseDate, parseNullableDate, toWire } from "@renderer/lib/api";

// Fields a PUT may change.
export type TaskUpdate = Partial<{
    title: string;
    description: string | null;
    due_at: Date | null;
    status: TaskStatus;
    project_id: string | null;
    feature_id: string | null;
    // The task's time block on the calendar.
    event_id: string | null;
}>;

function parseTask(t: ApiTask): Task {
    return {
        ...t,
        created_at: parseDate(t.created_at),
        updated_at: parseDate(t.updated_at),
        due_at: parseNullableDate(t.due_at),
        completed_at: parseNullableDate(t.completed_at),
    };
}

async function getTasks(): Promise<Task[]> {
    const raw = await api.listTasks();
    return raw.map(parseTask);
}

function addTask(
    title: string,
    description: string | null,
    due_at: Date | null,
    project_id?: string,
    feature_id?: string,
): Promise<unknown> {
    return api.createTask(toWire({ title, description, due_at, project_id, feature_id }));
}

// Resolves to the updated row.
async function updateTask(id: string, data: TaskUpdate): Promise<Task> {
    return parseTask(await api.updateTask(id, toWire(data)));
}

function deleteTask(id: string): Promise<unknown> {
    return api.deleteTask(id);
}

export { getTasks, addTask, updateTask, deleteTask };
