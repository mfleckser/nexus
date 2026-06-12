import { useState } from "react";
import { Plus } from "lucide-react";
import { useProjects } from "@renderer/features/projects/useProjects";
import ProjectCard from "@renderer/features/projects/ProjectCard";
import NewProjectModal from "@renderer/features/projects/NewProjectModal";
import "./projectList.css";

function ProjectList(): React.JSX.Element {
    const { projects, addProject } = useProjects();
    const [showModal, setShowModal] = useState(false);

    return (
        <div className="projects-shell">
            <div className="projects-header">
                <h1 className="projects-title">Projects</h1>
                <button className="projects-new-btn" onClick={() => setShowModal(true)}>
                    <Plus size={16} />
                    New Project
                </button>
            </div>

            {projects.length === 0 ? (
                <div className="projects-empty">
                    <p className="projects-empty-title">No projects yet</p>
                    <p className="projects-empty-sub">Create your first project to get started.</p>
                </div>
            ) : (
                <div className="projects-grid themed-scroll">
                    {projects.map(p => <ProjectCard key={p.id} project={p} />)}
                </div>
            )}

            {showModal && <NewProjectModal onClose={() => setShowModal(false)} onSave={addProject} />}
        </div>
    );
}

export default ProjectList;
