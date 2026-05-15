import Home from "./pages/Home/Home"

import "./theme.css"
import "./root.css"

function App(): React.JSX.Element {
  const ipcHandle = (): void => window.electron.ipcRenderer.send('ping')

  return (
    <>
    <Home></Home>
    </>
  )
}

export default App
