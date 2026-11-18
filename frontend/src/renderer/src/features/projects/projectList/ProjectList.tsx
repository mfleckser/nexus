import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useProjects } from "@renderer/features/projects/useProjects";
import ProjectCard from "@renderer/features/projects/projectList/ProjectCard";
import ProjectModal from "@renderer/components/ProjectModal";
import "./projectList.css";
import useReportError from "@renderer/hooks/useReportError";
import { PROJECT_STATUSES } from "@renderer/types";
import {
    CLEARED_FILTERS,
    filterAndSortProjects,
    NO_STATUS,
    NOT_ARCHIVED,
    onlyArchivedHidden,
    parseView,
    ProjectListView,
    ProjectSort,
    ProjectStatusFilter,
    projectTypeOptions,
    SORT_OPTIONS,
    UNTYPED,
} from "@renderer/lib/projectFilters";

// Sort and filters persist per machine; search text deliberately doesn't.
const VIEW_STORAGE_KEY = "nexus.projectList.view";

function loadView(): ProjectListView {
    try {
        return parseView(localStorage.getItem(VIEW_STORAGE_KEY));
    } catch {
        return parseView(null);
    }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const STATUS_OPTIONS: { value: ProjectStatusFilter; label: string }[] = [
    { value: NOT_ARCHIVED, label: "Not archived" },
    { value: "all", label: "All statuses" },
    ...PROJECT_STATUSES.map((s) => ({ value: s, label: capitalize(s) })),
    { value: NO_STATUS, label: "No status" },
];

function ProjectList(): React.JSX.Element {
    const { projects, projectsLoaded, addProject } = useProjects();
    const reportError = useReportError();
    const [showModal, setShowModal] = useState(false);
    const [view, setView] = useState<ProjectListView>(loadView);
    const [search, setSearch] = useState("");

    useEffect(() => {
        try {
            localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
        } catch {
            // Storage unavailable; the view just won't persist.
        }
    }, [view]);

    const visible = useMemo(() => filterAndSortProjects(projects, view, search), [projects, view, search]);
    // Keep a stored type selectable even if no project has it any more.
    const typeOptions = useMemo(() => {
        const opts = projectTypeOptions(projects);
        return view.type === "all" || opts.includes(view.type) ? opts : [...opts, view.type];
    }, [projects, view.type]);

    return (
        <div className="projects-shell">
            <div className="projects-header">
                <h1 className="projects-title">Projects</h1>
                <button className="projects-new-btn" onClick={() => setShowModal(true)}>
                    <Plus size={16} />
                    New Project
                </button>
            </div>

            {!projectsLoaded ? null : projects.length === 0 ? (
                <div className="projects-empty">
                    <p className="projects-empty-title">No projects yet</p>
                    <p className="projects-empty-sub">Create your first project to get started.</p>
                </div>
            ) : (
                <>
                    <div className="projects-toolbar">
                        <label className="projects-search">
                            <Search size={14} aria-hidden />
                            <input
                                type="search"
                                placeholder="Search projects"
                                aria-label="Search projects"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </label>
                        <div className="projects-select-wrap">
                            <select
                                className="projects-select"
                                aria-label="Filter by type"
                                value={view.type}
                                onChange={(e) => setView((v) => ({ ...v, type: e.target.value }))}
                            >
                                <option value="all">All types</option>
                                {typeOptions.map((t) => (
                                    <option key={t} value={t}>
                                        {t === UNTYPED ? "Untyped" : capitalize(t)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="projects-select-wrap">
                            <select
                                className="projects-select"
                                aria-label="Filter by status"
                                value={view.status}
                                onChange={(e) =>
                                    setView((v) => ({ ...v, status: e.target.value as ProjectStatusFilter }))
                                }
                            >
                                {STATUS_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="projects-select-wrap projects-sort">
                            <select
                                className="projects-select"
                                aria-label="Sort projects"
                                value={view.sort}
                                onChange={(e) => setView((v) => ({ ...v, sort: e.target.value as ProjectSort }))}
                            >
                                {SORT_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    {visible.length === 0 ? (
                        <div className="projects-no-match">
                            <span>
                                {onlyArchivedHidden(view, search) ? "All projects are archived" : "No projects match"}
                            </span>
                            <button
                                type="button"
                                className="projects-clear-btn"
                                onClick={() => {
                                    setSearch("");
                                    setView((v) => ({ ...v, ...CLEARED_FILTERS }));
                                }}
                            >
                                Clear filters
                            </button>
                        </div>
                    ) : (
                        <div className="projects-grid themed-scroll">
                            {visible.map((p) => (
                                <ProjectCard key={p.id} project={p} />
                            ))}
                        </div>
                    )}
                </>
            )}

            {showModal && (
                <ProjectModal
                    heading="New Project"
                    submitLabel="Create"
                    onClose={() => setShowModal(false)}
                    onSave={(v) =>
                        addProject(v.title, v.description, v.type || null)
                            .then((created) => {
                                // Don't let the current search/filters hide what was just made.
                                if (filterAndSortProjects([created], view, search).length === 0) {
                                    setSearch("");
                                    setView((prev) => ({ ...prev, ...CLEARED_FILTERS }));
                                }
                            })
                            .catch((err) => reportError("Couldn't create project", err))
                    }
                />
            )}
        </div>
    );
}

export default ProjectList;
