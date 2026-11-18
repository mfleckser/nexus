import { useCallback, useEffect, useEffectEvent, useMemo, useRef } from "react";
import { useProjects } from "@renderer/features/projects/useProjects";
import { useTasks } from "@renderer/features/tasks/useTasks";
import useNow from "@renderer/hooks/useNow";
import useReportError from "@renderer/hooks/useReportError";
import { Task } from "@renderer/types";
import { featureNameFor, projectsToLoadFeatures } from "@renderer/lib/taskFeatures";

// How often every loaded project's features are refetched (also on window focus).
const REFRESH_MS = 5 * 60 * 1000;

// Loads the features of every project with main-view tasks in a feature, so the
// calendar and task list can show feature names (useTaskFeatureName). Mounted
// once by the page that shows those views (Home).
export function useLoadTaskFeatures(): void {
    const { tasks } = useTasks();
    const { projects, featuresByProjectId, loadFeatures } = useProjects();
    const reportError = useReportError();
    const now = useNow(REFRESH_MS);
    // Feature ids already fetched for since the last refresh (see projectsToLoadFeatures).
    const requestedRef = useRef(new Set<string>());

    // Tasks of known projects shown in the main view (hidden projects' tasks
    // don't render, so their features aren't fetched).
    const shownTasks = useMemo(() => {
        const shown = new Set(projects.filter((p) => p.show_tasks_in_main_view).map((p) => p.id));
        return tasks.filter((t) => t.project_id !== null && shown.has(t.project_id));
    }, [tasks, projects]);

    const load = useCallback(
        (projectIds: string[]) => {
            for (const id of projectIds) {
                loadFeatures(id).catch((err) => reportError("Couldn't load features", err));
            }
        },
        [loadFeatures, reportError],
    );

    // Periodic full refresh: picks up renames made elsewhere and retries failed loads.
    const refreshAll = useEffectEvent(() => {
        requestedRef.current.clear();
        // With nothing counted as loaded, this is every project with a featured task.
        load(projectsToLoadFeatures(shownTasks, {}, requestedRef.current));
    });
    useEffect(() => refreshAll(), [now]);

    // Fetch as soon as a task's feature is missing (first load, or a new feature).
    useEffect(() => {
        load(projectsToLoadFeatures(shownTasks, featuresByProjectId, requestedRef.current));
    }, [shownTasks, featuresByProjectId, load]);
}

// The task's feature name once its project's features are loaded, else null.
export function useTaskFeatureName(task: Task): string | null {
    const { featuresByProjectId } = useProjects();
    return featureNameFor(task, featuresByProjectId);
}
