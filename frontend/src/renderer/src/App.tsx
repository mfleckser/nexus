import Home from "./pages/Home/Home"
import { TasksProvider } from "./hooks/useTasks"
import { EventsProvider } from "./hooks/useEvents"

import "./theme.css"
import "./root.css"

function App(): React.JSX.Element {
  return (
    <EventsProvider>
      <TasksProvider>
        <Home></Home>
      </TasksProvider>
    </EventsProvider>
  )
}

export default App
