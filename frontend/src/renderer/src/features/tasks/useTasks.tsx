import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import * as tasksApi from "@renderer/features/tasks/tasks.api";
import { Task, TaskStatus } from "@renderer/types";
import useNow from "@renderer/hooks/useNow";
import useReportError from "@renderer/hooks/useReportError";
import { sameSet } from "@renderer/lib/collections";

// What callers may pass to updateTask: forms hand over due dates as
// datetime-local strings ("2026-09-30T10:00", no offset).
export type TaskChanges = Partial<{
    title: string;
    description: string | null;
    due_at: Date | string | null;
    status: TaskStatus;
    project_id: string | null;
    feature_id: string | null;
}>;

type TasksContextValue = {
    tasks: Task[];
    addTask: (
        title: string,
        description: string | null,
        due_at: string | null,
        project_id?: string,
        feature_id?: string,
    ) => Promise<void>;
    // Optimistic; rolls back and rethrows on failure.
    updateTask: (id: string, changes: TaskChanges) => Promise<void>;
    deleteTask: (id: string) => Promise<void>;
};

const TasksContext = createContext<TasksContextValue | null>(null);

export function TasksProvider({ children }: { children: ReactNode }) {
    const [tasks, setTasks] = useState<Task[]>([]);
    const now = useNow(15000);
    const reportError = useReportError();
    // Latest state, for rollback snapshots taken inside stable callbacks.
    const tasksRef = useRef(tasks);
    useEffect(() => {
        tasksRef.current = tasks;
    }, [tasks]);

    // Only the newest fetch may write state; mutations bump this so a poll
    // that read pre-mutation rows can't land on top of the mutation's result.
    const fetchSeqRef = useRef(0);
    // Set after a failed mutation: the next fetch replaces state outright, since
    // sameSet (id + updated_at) can't see a rolled-back edit as out of sync.
    const forceReplaceRef = useRef(false);

    const refresh = useCallback(async () => {
        const seq = ++fetchSeqRef.current;
        const force = forceReplaceRef.current;
        const fresh = await tasksApi.getTasks();
        if (seq !== fetchSeqRef.current) return;
        if (force) forceReplaceRef.current = false;
        setTasks((prev) => (!force && sameSet(fresh, prev) ? prev : fresh));
    }, []);

    const resync = useCallback(() => {
        forceReplaceRef.current = true;
        refresh().catch(() => {});
    }, [refresh]);

    useEffect(() => {
        refresh().catch((err) => reportError("Couldn't refresh tasks", err));
    }, [now, refresh, reportError]);

    const addTask = useCallback(
        async (
            title: string,
            description: string | null,
            due_at: string | null,
            project_id?: string,
            feature_id?: string,
        ) => {
            const dueDate = due_at ? new Date(due_at) : null;
            await tasksApi.addTask(title, description, dueDate, project_id, feature_id);
            await refresh();
        },
        [refresh],
    );

    const updateTask = useCallback(
        async (id: string, changes: TaskChanges) => {
            // Parse datetime-local strings as local time so state holds a Date and
            // the server gets a UTC instant instead of reading the bare string as UTC.
            const { due_at, ...rest } = changes;
            const data: tasksApi.TaskUpdate =
                due_at === undefined
                    ? rest
                    : { ...rest, due_at: typeof due_at === "string" ? new Date(due_at) : due_at };
            const before = tasksRef.current.find((t) => t.id === id);
            fetchSeqRef.current++;
            setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...data } : t)));
            try {
                const saved = await tasksApi.updateTask(id, data);
                fetchSeqRef.current++;
                setTasks((prev) => prev.map((t) => (t.id === id ? saved : t)));
            } catch (err) {
                if (before) setTasks((prev) => prev.map((t) => (t.id === id ? before : t)));
                resync();
                throw err;
            }
        },
        [resync],
    );

    const deleteTask = useCallback(
        async (id: string) => {
            const before = tasksRef.current.find((t) => t.id === id);
            fetchSeqRef.current++;
            setTasks((prev) => prev.filter((t) => t.id !== id));
            try {
                await tasksApi.deleteTask(id);
                fetchSeqRef.current++;
            } catch (err) {
                if (before) setTasks((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, before]));
                resync();
                throw err;
            }
        },
        [resync],
    );

    const value = useMemo(() => ({ tasks, addTask, updateTask, deleteTask }), [tasks, addTask, updateTask, deleteTask]);

    return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- provider and hook share the private context; HMR reloads this file fully
export function useTasks(): TasksContextValue {
    const ctx = useContext(TasksContext);
    if (!ctx) throw new Error("useTasks must be used within TasksProvider");
    return ctx;
}
