import type { Feature, Task } from "../types";

type TaskRef = Pick<Task, "project_id" | "feature_id">;
type FeatureRef = Pick<Feature, "id" | "name">;

// The task's feature name, or null when it has none or that project's features
// aren't loaded (yet).
function featureNameFor(task: TaskRef, featuresByProjectId: Record<string, FeatureRef[]>): string | null {
    if (!task.project_id || !task.feature_id) return null;
    return featuresByProjectId[task.project_id]?.find((f) => f.id === task.feature_id)?.name ?? null;
}

// Projects whose features must be (re)loaded so these tasks' feature names can
// show: a task's feature is missing from its project's loaded list (never
// loaded, or created since). Feature ids in `requested` were already asked for
// and are skipped, so an id the backend no longer has can't refetch forever.
// Adds each id it returns a project for to `requested`.
function projectsToLoadFeatures(
    tasks: TaskRef[],
    featuresByProjectId: Record<string, FeatureRef[]>,
    requested: Set<string>,
): string[] {
    const out = new Set<string>();
    for (const t of tasks) {
        if (!t.project_id || !t.feature_id || requested.has(t.feature_id)) continue;
        if (featureNameFor(t, featuresByProjectId) !== null) continue;
        requested.add(t.feature_id);
        out.add(t.project_id);
    }
    return [...out];
}

export { featureNameFor, projectsToLoadFeatures };
