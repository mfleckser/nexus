import { Route, Routes } from "react-router-dom";
import ProjectList from "@renderer/features/projects/projectList/ProjectList";
import ProjectDetail from "@renderer/features/projects/projectDetail/ProjectDetail";
import "./projects.css";

function Projects(): React.JSX.Element {
    return (
        <div className="projects-page">
            <Routes>
                <Route index element={<ProjectList />} />
                <Route path=":projectId" element={<ProjectDetail />} />
            </Routes>
        </div>
    );
}

export default Projects;
