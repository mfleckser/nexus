import { useProjects } from "@renderer/hooks/useProjects";
import { useParams } from "react-router-dom";

function ProjectDetail(): React.JSX.Element {
    const {projectId} = useParams();
    const {projects} = useProjects();
    const project = projects.find(p => p.id === projectId);

    return (
        <div className="project-detail-container">
            <div>{project?.title}</div>
        </div>
    )
}

export default ProjectDetail;
