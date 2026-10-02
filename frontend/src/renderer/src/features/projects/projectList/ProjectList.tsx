import { useState } from "react";
import { Plus } from "lucide-react";
import { useProjects } from "@renderer/features/projects/useProjects";
import ProjectCard from "@renderer/features/projects/projectList/ProjectCard";
import ProjectModal from "@renderer/components/ProjectModal";
import "./projectList.css";
import useReportError from "@renderer/hooks/useReportError";

function ProjectList(): React.JSX.Element {
    const { projects, projectsLoaded, addProject } = useProjects();
    const reportError = useReportError();
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

            {!projectsLoaded ? null : projects.length === 0 ? (
                <div className="projects-empty">
                    <p className="projects-empty-title">No projects yet</p>
                    <p className="projects-empty-sub">Create your first project to get started.</p>
                </div>
            ) : (
                <div className="projects-grid themed-scroll">
                    {projects.map((p) => (
                        <ProjectCard key={p.id} project={p} />
                    ))}
                </div>
            )}

            {showModal && (
                <ProjectModal
                    heading="New Project"
                    submitLabel="Create"
                    onClose={() => setShowModal(false)}
                    onSave={(v) =>
                        addProject(v.title, v.description, v.type || null).catch((err) =>
                            reportError("Couldn't create project", err),
                        )
                    }
                />
            )}
        </div>
    );
}

export default ProjectList;
