import { calendarDaysBetween } from "./dates";

// The main task list's due-date sections, in display order.
export const TASK_GROUPS = [
    { key: "overdue", name: "Overdue" },
    { key: "today", name: "Today" },
    { key: "thisWeek", name: "This Week" },
    { key: "future", name: "Future" },
    { key: "noDueDate", name: "No Due Date" },
] as const;

export type TaskGroupKey = (typeof TASK_GROUPS)[number]["key"];

// The fields grouping reads, so it works on any client's parsed task rows.
export type GroupableTask = {
    status: string;
    due_at: Date | null;
    project_id: string | null;
    created_at: Date;
};

// The section a task belongs in on `now`'s day, by calendar days to its due
// date. Completed tasks leave the list once they're overdue or undated.
export function taskGroup(task: GroupableTask, now: Date): TaskGroupKey | null {
    const complete = task.status === "complete";
    if (task.due_at === null) return complete ? null : "noDueDate";
    const days = calendarDaysBetween(now, task.due_at);
    if (days < 0) return complete ? null : "overdue";
    if (days === 0) return "today";
    if (days <= 7) return "thisWeek";
    return "future";
}

// Tasks by section, oldest first within each. Tasks of `hiddenProjectIds`
// (projects with show_tasks_in_main_view off) are left out.
export function groupTasks<T extends GroupableTask>(
    tasks: readonly T[],
    now: Date,
    hiddenProjectIds: ReadonlySet<string> = new Set(),
): Record<TaskGroupKey, T[]> {
    const groups: Record<TaskGroupKey, T[]> = { overdue: [], today: [], thisWeek: [], future: [], noDueDate: [] };
    for (const task of tasks) {
        if (task.project_id !== null && hiddenProjectIds.has(task.project_id)) continue;
        const key = taskGroup(task, now);
        if (key) groups[key].push(task);
    }
    for (const list of Object.values(groups)) list.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    return groups;
}
