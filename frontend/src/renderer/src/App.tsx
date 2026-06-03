import Home from "./pages/Home/Home"
import { TasksProvider } from "./hooks/useTasks"
import { EventsProvider } from "./hooks/useEvents"

import "./theme.css"
import "./root.css"
import { Route, Routes } from "react-router-dom"
import Projects from "./pages/Projects/Projects"
import Sidebar from "./Sidebar"

function App(): React.JSX.Element {
  return (
    <EventsProvider>
      <TasksProvider>
        <Sidebar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/projects" element={<Projects />} />
        </Routes>
      </TasksProvider>
    </EventsProvider>
  )
}

export default App
