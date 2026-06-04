import Home from "./pages/Home/Home"
import { TasksProvider } from "./hooks/useTasks"
import { EventsProvider } from "./hooks/useEvents"

import "./theme.css"
import "./root.css"
import { Route, Routes } from "react-router-dom"
import Projects from "./pages/Projects/Projects"
import Sidebar from "./Sidebar"
import { ProjectsProvider } from "./hooks/useProjects"

function App(): React.JSX.Element {
  return (
    <EventsProvider>
      <TasksProvider>
        <ProjectsProvider>
          <Sidebar />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/projects/*" element={<Projects />} />
          </Routes>
        </ProjectsProvider>
      </TasksProvider>
    </EventsProvider>
  )
}

export default App
