import { useProjects } from "@renderer/features/projects/useProjects";
import { ChevronLeft, Ellipsis, FolderX, NotebookPen } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import "./projectDetail.css";
import { useCallback, useEffect, useState } from "react";
import ConfirmDelete from "@renderer/components/ConfirmDelete";
import ProjectModal from "@renderer/components/ProjectModal";
import KanbanBoard from "./KanbanBoard";
import NotesPanel from "./NotesPanel";
import useReportError, { errorMessage } from "@renderer/hooks/useReportError";

function ProjectDetail(): React.JSX.Element {
    const [showProjectMenu, setShowProjectMenu] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);
    const [showNotes, setShowNotes] = useState(false);

    // Notes load failure, tagged with the project it belongs to.
    const [notesError, setNotesError] = useState<{ projectId: string; message: string } | null>(null);

    const nav = useNavigate();
    const reportError = useReportError();
    const { projectId } = useParams();
    const { projects, projectsLoaded, updateProject, deleteProject, notesByProjectId, loadNotes, updateNotes } =
        useProjects();
    const project = projects.find((p) => p.id === projectId);

    const fetchNotes = useCallback(
        (id: string) => {
            loadNotes(id).catch((err) => setNotesError({ projectId: id, message: errorMessage(err) }));
        },
        [loadNotes],
    );

    useEffect(() => {
        if (projectId) fetchNotes(projectId);
    }, [projectId, fetchNotes]);

    if (!project && !projectsLoaded) {
        return (
            <div className="pd-not-found">
                <span className="pd-loading">Loading project…</span>
            </div>
        );
    }

    if (!project) {
        return (
            <div className="pd-not-found">
                <div className="pd-not-found-card">
                    <div className="pd-not-found-icon">
                        <FolderX size={28} />
                    </div>
                    <h2 className="pd-not-found-title">Project not found</h2>
                    <p className="pd-not-found-text">This project doesn’t exist or may have been deleted.</p>
                    <Link className="pd-not-found-link" to="/projects">
                        <ChevronLeft size={16} />
                        Back to Projects
                    </Link>
                </div>
            </div>
        );
    }

    const saveNotes = (notes: string) =>
        updateNotes(project.id, notes).catch((err) => reportError("Couldn't save notes", err));

    return (
        <div
            className="pd-container"
            onClick={() => {
                setShowProjectMenu(false);
            }}
        >
            <div className="pd-header">
                <Link className="pd-back-link" to="/projects">
                    <ChevronLeft size={16} />
                    Back to Project List
                </Link>
                <div className="pd-header-main">
                    <h1 className="pd-title">{project.title}</h1>
                    <div className="pd-header-actions">
                        <button
                            type="button"
                            className={`pd-notes-toggle${showNotes ? " pd-notes-toggle-active" : ""}`}
                            aria-label={showNotes ? "Close notes" : "Open notes"}
                            aria-pressed={showNotes}
                            onClick={() => setShowNotes((prev) => !prev)}
                        >
                            <NotebookPen size={18} />
                        </button>
                        <div
                            className="pd-project-menu-container"
                            onClick={(e) => {
                                e.stopPropagation();
                            }}
                        >
                            <button
                                type="button"
                                className="pd-project-menu-btn"
                                aria-label="Project actions"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowProjectMenu((prev) => !prev);
                                }}
                            >
                                <Ellipsis size={18} />
                            </button>
                            {showProjectMenu && (
                                <div className="pd-project-menu">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowProjectMenu(false);
                                            setShowEditModal(true);
                                        }}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        type="button"
                                        className="pd-menu-danger"
                                        onClick={() => setShowConfirmDelete(true)}
                                    >
                                        Delete
                                    </button>
                                </div>
                            )}
                            {showEditModal && (
                                <ProjectModal
                                    heading="Edit Project"
                                    submitLabel="Save"
                                    initial={{
                                        title: project.title,
                                        description: project.description || "",
                                        type: project.type || "",
                                        status: project.status ?? "",
                                        show_tasks_in_main_view: project.show_tasks_in_main_view,
                                    }}
                                    onClose={() => setShowEditModal(false)}
                                    onSave={(values) =>
                                        updateProject(project.id, {
                                            ...values,
                                            type: values.type || null,
                                            status: values.status || null,
                                        }).catch((err) => reportError("Couldn't save project", err))
                                    }
                                />
                            )}
                            {showConfirmDelete && (
                                <ConfirmDelete
                                    onClose={() => setShowConfirmDelete(false)}
                                    onDelete={() => {
                                        deleteProject(project.id).catch((err) =>
                                            reportError("Couldn't delete project", err),
                                        );
                                        setShowConfirmDelete(false);
                                        nav("/projects");
                                    }}
                                    itemName="project"
                                />
                            )}
                        </div>
                    </div>
                </div>
                {project.description && <p className="pd-description">{project.description}</p>}
            </div>
            <div className="pd-body">
                <KanbanBoard project={project} />
                {showNotes && (
                    <NotesPanel
                        key={project.id}
                        notes={notesByProjectId[project.id]}
                        loadError={notesError?.projectId === project.id ? notesError.message : null}
                        onRetry={() => {
                            setNotesError(null);
                            fetchNotes(project.id);
                        }}
                        onSave={saveNotes}
                    />
                )}
            </div>
        </div>
    );
}

export default ProjectDetail;
