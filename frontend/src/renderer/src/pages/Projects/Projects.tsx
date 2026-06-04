import { Route, Routes } from "react-router-dom";
import ProjectList from "./ProjectList";
import ProjectDetail from "./ProjectDetail";

function Projects(): React.JSX.Element {
    return (
        <Routes>
            <Route index element={<ProjectList />} />
            <Route path=":projectId" element={<ProjectDetail />} />
        </Routes>
    )
}

export default Projects;
