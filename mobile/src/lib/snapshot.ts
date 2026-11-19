import type { Event as ApiEvent, Task as ApiTask } from "@nexus/shared";

// The last data fetched from the backend, kept on the phone so the agenda
// still shows (read-only) when the backend can't be reached. Stored as the
// API's own JSON.
export type Snapshot = {
    version: typeof SNAPSHOT_VERSION;
    // ISO time of the fetch.
    fetchedAt: string;
    tasks: ApiTask[];
    events: ApiEvent[];
    // Projects with show_tasks_in_main_view off.
    hiddenProjectIds: string[];
};

// Bump when the stored shape changes; older snapshots are then ignored.
export const SNAPSHOT_VERSION = 1;

export const serializeSnapshot = (snapshot: Snapshot): string => JSON.stringify(snapshot);

// The stored snapshot, or null if there is none or it's unreadable or from
// another version.
export function parseSnapshot(text: string | null): Snapshot | null {
    if (!text) return null;
    try {
        const value: unknown = JSON.parse(text);
        if (!value || typeof value !== "object") return null;
        const s = value as Partial<Snapshot>;
        if (
            s.version !== SNAPSHOT_VERSION ||
            typeof s.fetchedAt !== "string" ||
            !Array.isArray(s.tasks) ||
            !Array.isArray(s.events) ||
            !Array.isArray(s.hiddenProjectIds)
        ) {
            return null;
        }
        return s as Snapshot;
    } catch {
        return null;
    }
}
