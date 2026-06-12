import { Project } from "@renderer/types";
import "./projectCard.css";
import { Link } from "react-router-dom";

const formatDate = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

type ProjectCardProps = {
    project: Project;
};

function ProjectCard({ project }: ProjectCardProps): React.JSX.Element {
    return (
        <Link to={project.id} className="project-card">
            <div className="project-card-top">
                <span className="project-type-badge">{project.type || "untyped"}</span>
                <span className={`project-status status-${project.status}`}>
                    <span className="project-status-dot" aria-hidden />
                    {project.status}
                </span>
            </div>

            <h3 className="project-card-title">{project.title}</h3>

            <p className={`project-card-desc${project.description ? "" : " muted"}`}>
                {project.description || "No description"}
            </p>

            <div className="project-card-footer">
                <span className="project-card-meta">Updated {formatDate(project.updated_at)}</span>
            </div>
        </Link>
    );
}

export default ProjectCard;
