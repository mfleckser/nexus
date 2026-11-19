import axios, { AxiosError, Method } from "axios";
import { API_PREFIX, httpFailure, nexusHeaders } from "@nexus/shared";
import type { ApiResult } from "../shared/ipc";

// Backend location + token come from frontend/.env (see .env.example) and are
// baked into the main-process build; the renderer never sees them.
const ORIGIN = (import.meta.env.MAIN_VITE_NEXUS_API_URL || "http://127.0.0.1:5001").replace(/\/+$/, "");
const BASE_URL = `${ORIGIN}${API_PREFIX}`;

const client = axios.create({
    baseURL: BASE_URL,
    timeout: 5000,
    // The client name is stamped on the rows this app creates (created_via).
    headers: nexusHeaders(import.meta.env.MAIN_VITE_NEXUS_API_TOKEN ?? "", "desktop"),
    // Paths always resolve against baseURL; an absolute URL from the renderer
    // must never redirect the request elsewhere.
    allowAbsoluteUrls: false,
});

// API paths are backend-relative ("/tasks", "/events/<id>?scope=all").
function isApiPath(path: unknown): path is string {
    return typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}

function errorResult(err: unknown): ApiResult {
    if (err instanceof AxiosError) {
        if (err.response) {
            return httpFailure(err.response.status, err.response.statusText, err.response.data);
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
