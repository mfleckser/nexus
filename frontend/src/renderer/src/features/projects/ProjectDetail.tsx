import { useProjects } from "@renderer/features/projects/useProjects";
import { ChevronLeft, Ellipsis, FolderX } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import "./projectDetail.css";
import { useState } from "react";
import ConfirmDelete from "@renderer/components/ConfirmDelete";
import KanbanBoard from "./KanbanBoard";

function ProjectDetail(): React.JSX.Element {
    const [showProjectMenu, setShowProjectMenu] = useState(false);
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);

    const {projectId} = useParams();
    const {projects, deleteProject} = useProjects();
    const project = projects.find(p => p.id === projectId);

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
        )
    }

    const nav = useNavigate();

    return (
        <div className="pd-container" onClick={() => {setShowProjectMenu(false)}}>
            <div className="pd-header">
                <Link className="pd-back-link" to="/projects"><ChevronLeft size={16} />Back to Project List</Link>
                <div className="pd-header-main">
                    <h1 className="pd-title">{project?.title}</h1>
                    <div className="pd-project-menu-container" onClick={e => {e.stopPropagation()}}>
                        <button
                            type="button"
                            className="pd-project-menu-btn"
                            aria-label="Project actions"
                            onClick={(e) => {e.stopPropagation(); setShowProjectMenu(prev => !prev);}}
                        >
                            <Ellipsis size={18} />
                        </button>
                        {showProjectMenu && <div className="pd-project-menu">
                            <button type="button">Edit</button>
                            <button type="button" className="pd-menu-danger" onClick={() => setShowConfirmDelete(true)}>Delete</button>
                        </div>}
                        {showConfirmDelete && <ConfirmDelete
                            onClose={() => setShowConfirmDelete(false)}
                            onDelete={() => {deleteProject(project?.id || ""); setShowConfirmDelete(false); nav("/projects")}}
                            itemName="project"
                        />}
                    </div>
                </div>
                {project?.description && <p className="pd-description">{project?.description}</p>}
            </div>
            <KanbanBoard project={project}/>
        </div>
    )
}

export default ProjectDetail;
