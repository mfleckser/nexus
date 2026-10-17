import axios, { AxiosError, Method } from "axios";
import type { ApiResult } from "../shared/ipc";

// Backend location + token come from frontend/.env (see .env.example) and are
// baked into the main-process build; the renderer never sees them.
const ORIGIN = (import.meta.env.MAIN_VITE_NEXUS_API_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
const BASE_URL = `${ORIGIN}/api`;

const client = axios.create({
    baseURL: BASE_URL,
    timeout: 5000,
    headers: { Authorization: `Bearer ${import.meta.env.MAIN_VITE_NEXUS_API_TOKEN ?? ""}` },
    // Paths always resolve against baseURL; an absolute URL from the renderer
    // must never redirect the request elsewhere.
    allowAbsoluteUrls: false,
});

// API paths are backend-relative ("/tasks", "/events/<id>?scope=all").
function isApiPath(path: unknown): path is string {
    return typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}

// Backend errors are JSON `{"error": "<message>"}`; fall back to the status line.
function errorResult(err: unknown): ApiResult {
    if (err instanceof AxiosError) {
        if (err.response) {
            const body: unknown = err.response.data;
            const backendMessage =
                body && typeof body === "object" && "error" in body && typeof body.error === "string"
                    ? body.error
                    : null;
            const status = err.response.status;
            return {
                ok: false,
                status,
                message:
                    backendMessage ??
                    `Request failed (${status}${err.response.statusText ? ` ${err.response.statusText}` : ""})`,
            };
        }
        if (err.code === AxiosError.ECONNABORTED || err.code === AxiosError.ETIMEDOUT) {
            return { ok: false, status: null, message: "The backend took too long to respond" };
        }
        return { ok: false, status: null, message: `Can't reach the backend at ${BASE_URL}` };
    }
    return { ok: false, status: null, message: err instanceof Error ? err.message : String(err) };
}

export async function apiRequest(method: Method, path: unknown, body?: unknown): Promise<ApiResult> {
    if (!isApiPath(path)) {
        return { ok: false, status: null, message: `Invalid API path: ${String(path)}` };
    }
    try {
        const res = await client.request({ method, url: path, data: body });
        return { ok: true, data: res.data };
    } catch (err) {
        return errorResult(err);
    }
}
