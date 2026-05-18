import Home from "./pages/Home/Home"
import { TasksProvider } from "./hooks/useTasks"

import "./theme.css"
import "./root.css"

function App(): React.JSX.Element {
  return (
    <TasksProvider>
      <Home></Home>
    </TasksProvider>
  )
}

export default App
