import { ApiError, type EventCreate, type Task as ApiTask, type TaskCreate } from "@nexus/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { api } from "../api";
import { agendaWindow } from "../lib/agenda";
import { SNAPSHOT_VERSION, type Snapshot } from "../lib/snapshot";
import { parseEvent, parseTask } from "../lib/types";
import { loadSnapshot, saveSnapshot } from "./storage";

// loading: no answer from the backend yet. offline: the last fetch couldn't
// reach it, so the agenda shows the stored snapshot and writes are blocked.
export type Connection = "loading" | "online" | "offline";

const POLL_MS = 60_000;
// How long an error toast stays up.
const ERROR_MS = 6_000;

const isUnreachable = (err: unknown): boolean => err instanceof ApiError && err.status === null;
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function useAgendaData() {
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [connection, setConnection] = useState<Connection>("loading");
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Bumped when a write starts and when it settles; a fetch that overlapped
    // one is dropped and redone so it can't put back rows from before the write.
    const writeSeq = useRef(0);
    const inFlight = useRef<Promise<void> | null>(null);
    const snapshotRef = useRef(snapshot);
    useEffect(() => {
        snapshotRef.current = snapshot;
    }, [snapshot]);

    // Applies a server-confirmed change and keeps it as the offline copy.
    const commit = useCallback((update: (s: Snapshot) => Snapshot) => {
        setSnapshot((prev) => {
            if (!prev) return prev;
            const next = update(prev);
            saveSnapshot(next);
            return next;
        });
    }, []);

    const refresh = useCallback((): Promise<void> => {
        if (inFlight.current) return inFlight.current;
        const run = async (): Promise<void> => {
            for (;;) {
                const seq = writeSeq.current;
                const { start, end } = agendaWindow(new Date());
                try {
                    const [tasks, events, projects] = await Promise.all([
                        api.listTasks(),
                        api.listEvents({ start: start.toISOString(), end: end.toISOString() }),
                        api.listProjects(),
                    ]);
                    if (seq !== writeSeq.current) continue;
                    const next: Snapshot = {
                        version: SNAPSHOT_VERSION,
                        fetchedAt: new Date().toISOString(),
                        tasks,
                        events,
                        hiddenProjectIds: projects.filter((p) => !p.show_tasks_in_main_view).map((p) => p.id),
                    };
                    setSnapshot(next);
                    saveSnapshot(next);
                    setConnection("online");
                    setError(null);
                } catch (err) {
                    if (isUnreachable(err)) setConnection("offline");
                    else {
                        // Reached the backend, which refused: still online.
                        setConnection("online");
                        setError(messageOf(err));
                    }
                }
                return;
            }
        };
        const promise = run().finally(() => {
            inFlight.current = null;
        });
        inFlight.current = promise;
        return promise;
    }, []);

    useEffect(() => {
        let cancelled = false;
        loadSnapshot().then((stored) => {
            // A fetch that already landed is newer than the stored copy.
            if (!cancelled && stored) setSnapshot((current) => current ?? stored);
        });
        refresh();
        const timer = setInterval(() => {
            if (AppState.currentState === "active") refresh();
        }, POLL_MS);
        const sub = AppState.addEventListener("change", (state) => {
            if (state === "active") refresh();
        });
        return () => {
            cancelled = true;
            clearInterval(timer);
            sub.remove();
        };
    }, [refresh]);

    useEffect(() => {
        if (!error) return;
        const timer = setTimeout(() => setError(null), ERROR_MS);
        return () => clearTimeout(timer);
    }, [error]);

    const pullToRefresh = useCallback(async () => {
        setRefreshing(true);
        await refresh();
        setRefreshing(false);
    }, [refresh]);

    // A write that failed: unreachable means we just went offline.
    const writeFailed = useCallback((what: string, err: unknown) => {
        if (isUnreachable(err)) setConnection("offline");
        setError(`${what}: ${messageOf(err)}`);
    }, []);

    const canWrite = connection === "online";

    const setTaskComplete = useCallback(
        async (id: string, complete: boolean) => {
            if (!canWrite) return;
            const original = snapshotRef.current?.tasks.find((t) => t.id === id);
            if (!original) return;
            writeSeq.current++;
            const status = complete ? "complete" : "todo";
            const replace = (row: ApiTask) => (s: Snapshot) => ({
                ...s,
                tasks: s.tasks.map((t) => (t.id === id ? row : t)),
            });
            setSnapshot((prev) => prev && replace({ ...original, status })(prev));
            try {
                commit(replace(await api.updateTask(id, { status })));
            } catch (err) {
                setSnapshot((prev) => prev && replace(original)(prev));
                writeFailed(complete ? "Couldn't complete task" : "Couldn't reopen task", err);
            } finally {
                writeSeq.current++;
            }
        },
        [canWrite, commit, writeFailed],
    );

    // Resolve to whether the row was created, so a form can stay open on failure.
    const createTask = useCallback(
        async (body: TaskCreate): Promise<boolean> => {
            if (!canWrite) return false;
            writeSeq.current++;
            try {
                const task = await api.createTask(body);
                commit((s) => ({ ...s, tasks: [...s.tasks, task] }));
                return true;
            } catch (err) {
                writeFailed("Couldn't add task", err);
                return false;
            } finally {
                writeSeq.current++;
            }
        },
        [canWrite, commit, writeFailed],
    );

    const createEvent = useCallback(
        async (body: EventCreate): Promise<boolean> => {
            if (!canWrite) return false;
            writeSeq.current++;
            try {
                const event = await api.createEvent(body);
                commit((s) => ({ ...s, events: [...s.events, event] }));
                return true;
            } catch (err) {
                writeFailed("Couldn't add event", err);
                return false;
            } finally {
                writeSeq.current++;
            }
        },
        [canWrite, commit, writeFailed],
    );

    const tasks = useMemo(() => (snapshot ? snapshot.tasks.map(parseTask) : []), [snapshot]);
    const events = useMemo(() => (snapshot ? snapshot.events.map(parseEvent) : []), [snapshot]);
    const hiddenProjectIds = useMemo(() => new Set(snapshot?.hiddenProjectIds ?? []), [snapshot]);
    const fetchedAt = useMemo(() => (snapshot ? new Date(snapshot.fetchedAt) : null), [snapshot]);

    return {
        tasks,
        events,
        hiddenProjectIds,
        fetchedAt,
        hasData: snapshot !== null,
        connection,
        canWrite,
        refreshing,
        error,
        dismissError: useCallback(() => setError(null), []),
        refresh,
        pullToRefresh,
        setTaskComplete,
        createTask,
        createEvent,
    };
}
