import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  health: () => ipcRenderer.invoke("health"),
  apiGet: (path: string) => ipcRenderer.invoke("apiGet", path),
  apiPost: (path: string, body: any) => ipcRenderer.invoke("apiPost", path, body),
  apiPut: (path: string, body: any) => ipcRenderer.invoke("apiPut", path, body),
  apiDelete: (path: string) => ipcRenderer.invoke("apiDelete", path),
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
