import { Route, Routes } from "react-router-dom";
import ProjectList from "./ProjectList";
import ProjectDetail from "./ProjectDetail";

function Projects(): React.JSX.Element {
    return (
        <div style={{width: "100%", height: "100%"}}>
            <Routes>
                <Route index element={<ProjectList />} />
                <Route path=":projectId" element={<ProjectDetail />} />
            </Routes>
        </div>
    )
}

export default Projects;
