import type { ApiResult } from "../../../shared/ipc";

// A failed backend call. `status` is the HTTP status, or null when the
// backend couldn't be reached.
export class ApiError extends Error {
    readonly status: number | null;

    constructor(message: string, status: number | null) {
        super(message);
        this.name = "ApiError";
        this.status = status;
    }
}

async function unwrap<T>(pending: Promise<ApiResult>): Promise<T> {
    const result = await pending;
    if (!result.ok) throw new ApiError(result.message, result.status);
    // The backend's JSON is trusted to match the declared shape.
    return result.data as T;
}

export const api = {
    get: <T>(path: string): Promise<T> => unwrap<T>(window.api.apiGet(path)),
    post: <T>(path: string, body: unknown): Promise<T> => unwrap<T>(window.api.apiPost(path, body)),
    put: <T>(path: string, body: unknown): Promise<T> => unwrap<T>(window.api.apiPut(path, body)),
    delete: <T>(path: string): Promise<T> => unwrap<T>(window.api.apiDelete(path)),
};

// JSON wire form of a row type: Date fields arrive as ISO strings.
export type Wire<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };

export const parseDate = (value: string): Date => new Date(value);
export const parseNullableDate = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);
