import { PROJECT_STATUSES } from "../types";
import type { Project, ProjectStatus } from "../types";

export type ProjectSort = "updated" | "name" | "newest" | "oldest";

// "all" = no filter. UNTYPED / NO_STATUS match empty fields. Type is free
// text, so its sentinel is one a real type won't plausibly use.
export const UNTYPED = "__untyped__";
export const NO_STATUS = "none";
export const NOT_ARCHIVED = "not-archived";

export type ProjectTypeFilter = string; // "all" | UNTYPED | a type name
export type ProjectStatusFilter = "all" | typeof NOT_ARCHIVED | typeof NO_STATUS | ProjectStatus;

export type ProjectListView = {
    sort: ProjectSort;
    type: ProjectTypeFilter;
    status: ProjectStatusFilter;
};

export const DEFAULT_VIEW: ProjectListView = { sort: "updated", type: "all", status: NOT_ARCHIVED };

// Showing everything; what "Clear filters" resets to (sort is kept).
export const CLEARED_FILTERS: Pick<ProjectListView, "type" | "status"> = { type: "all", status: "all" };

export const SORT_OPTIONS: { value: ProjectSort; label: string }[] = [
    { value: "updated", label: "Recently updated" },
    { value: "name", label: "Name A–Z" },
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
];

const STATUS_FILTERS: ProjectStatusFilter[] = ["all", NOT_ARCHIVED, NO_STATUS, ...PROJECT_STATUSES];

function matchesType(p: Project, type: ProjectTypeFilter): boolean {
    if (type === "all") return true;
    if (type === UNTYPED) return !p.type;
    return p.type === type;
}

function matchesStatus(p: Project, status: ProjectStatusFilter): boolean {
    if (status === "all") return true;
    if (status === NOT_ARCHIVED) return p.status !== "archived";
    if (status === NO_STATUS) return !p.status;
    return p.status === status;
}

function matchesSearch(p: Project, needle: string): boolean {
    if (!needle) return true;
    return p.title.toLowerCase().includes(needle) || (p.description ?? "").toLowerCase().includes(needle);
}

const COMPARATORS: Record<ProjectSort, (a: Project, b: Project) => number> = {
    updated: (a, b) => b.updated_at.getTime() - a.updated_at.getTime(),
    name: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }),
    newest: (a, b) => b.created_at.getTime() - a.created_at.getTime(),
    oldest: (a, b) => a.created_at.getTime() - b.created_at.getTime(),
};

/** Filters by search text (title + description, case-insensitive), type and status, then sorts. */
export function filterAndSortProjects(projects: Project[], view: ProjectListView, search: string): Project[] {
    const needle = search.trim().toLowerCase();
    return projects
        .filter((p) => matchesType(p, view.type) && matchesStatus(p, view.status) && matchesSearch(p, needle))
        .toSorted(COMPARATORS[view.sort]);
}

/** Type filter choices: every type in use (sorted), plus UNTYPED if any project has none. */
export function projectTypeOptions(projects: Project[]): string[] {
    const types = new Set<string>();
    let hasUntyped = false;
    for (const p of projects) {
        if (p.type) types.add(p.type);
        else hasUntyped = true;
    }
    const out = [...types].toSorted((a, b) => a.localeCompare(b));
    if (hasUntyped) out.push(UNTYPED);
    return out;
}

/** True when only the default "hide archived" filter is hiding anything. */
export function onlyArchivedHidden(view: ProjectListView, search: string): boolean {
    return view.status === NOT_ARCHIVED && view.type === "all" && !search.trim();
}

/** Parses a stored view, falling back to the default for any missing or invalid field. */
export function parseView(raw: string | null): ProjectListView {
    if (!raw) return DEFAULT_VIEW;
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return DEFAULT_VIEW;
    }
    if (typeof data !== "object" || data === null) return DEFAULT_VIEW;
    const v = data as Record<string, unknown>;
    return {
        sort: SORT_OPTIONS.some((o) => o.value === v.sort) ? (v.sort as ProjectSort) : DEFAULT_VIEW.sort,
        type: typeof v.type === "string" && v.type ? v.type : DEFAULT_VIEW.type,
        status: STATUS_FILTERS.includes(v.status as ProjectStatusFilter)
            ? (v.status as ProjectStatusFilter)
            : DEFAULT_VIEW.status,
    };
}
