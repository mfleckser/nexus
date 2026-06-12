import "./theme.css"
import "./root.css"

import { Route, Routes } from "react-router-dom"

import Home from "@renderer/pages/Home"
import Projects from "@renderer/pages/Projects"
import Sidebar from "@renderer/layout/Sidebar"

import { TasksProvider } from "@renderer/features/tasks/useTasks"
import { EventsProvider } from "@renderer/features/calendar/useEvents"
import { ProjectsProvider } from "@renderer/features/projects/useProjects"

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
