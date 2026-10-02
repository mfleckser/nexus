import { contextBridge, ipcRenderer } from "electron";
import type { ApiResult } from "../shared/ipc";

// Runs sandboxed: only `electron`'s renderer modules are available here.
const api = {
    apiGet: (path: string): Promise<ApiResult> => ipcRenderer.invoke("apiGet", path),
    apiPost: (path: string, body: unknown): Promise<ApiResult> => ipcRenderer.invoke("apiPost", path, body),
    apiPut: (path: string, body: unknown): Promise<ApiResult> => ipcRenderer.invoke("apiPut", path, body),
    apiDelete: (path: string): Promise<ApiResult> => ipcRenderer.invoke("apiDelete", path),
    // Returns an unsubscribe that removes only this callback's listener.
    onWindowFocus: (callback: () => void): (() => void) => {
        const listener = (): void => callback();
        ipcRenderer.on("window-focus", listener);
        return () => {
            ipcRenderer.removeListener("window-focus", listener);
        };
    },
};

export type NexusApi = typeof api;

contextBridge.exposeInMainWorld("api", api);
