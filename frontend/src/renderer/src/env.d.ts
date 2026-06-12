/// <reference types="vite/client" />

export {}

declare global {
    interface Window {
        api: {
            health: () => Promise<any>,
            apiGet: (path: string) => Promise<any>,
            apiPost: (path: string, body: any) => Promise<any>
            apiPut: (path: string, body: any) => Promise<any>
            apiDelete: (path: string) => Promise<any>
            onWindowFocus: (callback: () => void) => Promise<any>
            clearFocusCallback: () => Promise<any>
        }
    }
}
