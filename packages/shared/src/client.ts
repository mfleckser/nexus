import type { components, operations } from "./schema";

// Typed client for the Nexus API (backend/openapi.json). Request and response
// shapes come from the generated schema, so dates are ISO strings on the wire.
// How a request reaches the backend is the caller's Transport: the desktop app
// proxies through Electron IPC, other clients can use fetchTransport.

export type Schemas = components["schemas"];
export type Task = Schemas["Task"];
export type TaskCreate = Schemas["TaskCreate"];
export type TaskUpdate = Schemas["TaskUpdate"];
export type TaskStatus = Schemas["TaskStatus"];
export type Event = Schemas["Event"];
export type EventCreate = Schemas["EventCreate"];
export type EventUpdate = Schemas["EventUpdate"];
export type RecurrenceScope = Schemas["RecurrenceScope"];
export type ProjectSummary = Schemas["ProjectSummary"];
export type Project = Schemas["Project"];
export type ProjectCreate = Schemas["ProjectCreate"];
export type ProjectUpdate = Schemas["ProjectUpdate"];
export type ProjectStatus = Schemas["ProjectStatus"];
export type ProjectType = Schemas["ProjectType"];
export type FeatureSummary = Schemas["FeatureSummary"];
export type Feature = Schemas["Feature"];
export type FeatureCreate = Schemas["FeatureCreate"];
export type FeatureUpdate = Schemas["FeatureUpdate"];
export type NexusClientName = Schemas["Client"];

// Every route lives under this prefix on the backend origin (`/api` is a
// legacy alias of it).
export const API_PREFIX = "/api/v1";

// Headers every request carries: the bearer token and which client is calling
// (stored as `created_via` on the rows it creates).
export function nexusHeaders(token: string, client: NexusClientName): Record<string, string> {
    return { Authorization: `Bearer ${token}`, "X-Nexus-Client": client };
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type TransportRequest = {
    method: HttpMethod;
    // API-relative path with any query string ("/tasks", "/events?start=…").
    path: string;
    body?: unknown;
};

// Failures come back as data rather than a rejected promise, so a transport
// can cross boundaries (like Electron IPC) that drop error details.
export type TransportResult =
    | { ok: true; data: unknown }
    // status: HTTP status, or null when the backend was unreachable / timed out.
    | { ok: false; status: number | null; message: string };

export type Transport = (request: TransportRequest) => Promise<TransportResult>;

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

// Backend errors are JSON `{"error": "<message>"}`; fall back to the status line.
export function httpFailure(status: number, statusText: string, body: unknown): TransportResult {
    const backendMessage =
        body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
    return {
        ok: false,
        status,
        message: backendMessage ?? `Request failed (${status}${statusText ? ` ${statusText}` : ""})`,
    };
}

type Ok<O extends keyof operations> = operations[O]["responses"] extends {
    200: { content: { "application/json": infer R } };
}
    ? R
    : operations[O]["responses"] extends { 201: { content: { "application/json": infer R } } }
      ? R
      : never;
type Query<O extends keyof operations> = NonNullable<operations[O]["parameters"]["query"]>;

const seg = (value: string): string => encodeURIComponent(value);

function withQuery(path: string, query: Record<string, string | undefined> | undefined): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
}

export function createNexusClient(transport: Transport) {
    async function request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
        const result = await transport({ method, path, body });
        if (!result.ok) throw new ApiError(result.message, result.status);
        // The backend's JSON is trusted to match the spec.
        return result.data as T;
    }

    const occurrencePath = (masterId: string, originalStart: string): string =>
        `/events/${seg(masterId)}/occurrences/${seg(originalStart)}`;

    return {
        health: () => request<Ok<"getHealth">>("GET", "/health"),

        listTasks: (query?: Query<"listTasks">) => request<Ok<"listTasks">>("GET", withQuery("/tasks", query)),
        getTask: (id: string) => request<Ok<"getTask">>("GET", `/tasks/${seg(id)}`),
        createTask: (body: TaskCreate) => request<Ok<"createTask">>("POST", "/tasks", body),
        updateTask: (id: string, body: TaskUpdate) => request<Ok<"updateTask">>("PUT", `/tasks/${seg(id)}`, body),
        deleteTask: (id: string) => request<Ok<"deleteTask">>("DELETE", `/tasks/${seg(id)}`),

        // Recurring series come back expanded into the window's occurrences.
        listEvents: (query: Query<"listEvents">) => request<Ok<"listEvents">>("GET", withQuery("/events", query)),
        createEvent: (body: EventCreate) => request<Ok<"createEvent">>("POST", "/events", body),
        // Plain rows only: recurring rows are edited through the occurrence calls.
        updateEvent: (id: string, body: EventUpdate) => request<Ok<"updateEvent">>("PUT", `/events/${seg(id)}`, body),
        deleteEvent: (id: string) => request<Ok<"deleteEvent">>("DELETE", `/events/${seg(id)}`),
        // `originalStart`: the occurrence's original_start_at (ISO string).
        updateOccurrence: (masterId: string, originalStart: string, scope: RecurrenceScope, body: EventUpdate) =>
            request<Ok<"updateOccurrence">>("PUT", occurrencePath(masterId, originalStart), { ...body, scope }),
        deleteOccurrence: (masterId: string, originalStart: string, scope: RecurrenceScope) =>
            request<Ok<"deleteOccurrence">>("DELETE", withQuery(occurrencePath(masterId, originalStart), { scope })),

        listProjects: () => request<Ok<"listProjects">>("GET", "/projects"),
        getProject: (id: string) => request<Ok<"getProject">>("GET", `/projects/${seg(id)}`),
        createProject: (body: ProjectCreate) => request<Ok<"createProject">>("POST", "/projects", body),
        updateProject: (id: string, body: ProjectUpdate) =>
            request<Ok<"updateProject">>("PUT", `/projects/${seg(id)}`, body),
        deleteProject: (id: string) => request<Ok<"deleteProject">>("DELETE", `/projects/${seg(id)}`),
        getProjectNotes: (id: string) => request<Ok<"getProjectNotes">>("GET", `/projects/${seg(id)}/notes`),

        listFeatures: (projectId: string) => request<Ok<"listFeatures">>("GET", `/projects/${seg(projectId)}/features`),
        createFeature: (projectId: string, body: FeatureCreate) =>
            request<Ok<"createFeature">>("POST", `/projects/${seg(projectId)}/features`, body),
        getFeature: (id: string) => request<Ok<"getFeature">>("GET", `/features/${seg(id)}`),
        updateFeature: (id: string, body: FeatureUpdate) =>
            request<Ok<"updateFeature">>("PUT", `/features/${seg(id)}`, body),
        deleteFeature: (id: string) => request<Ok<"deleteFeature">>("DELETE", `/features/${seg(id)}`),
    };
}

export type NexusClient = ReturnType<typeof createNexusClient>;

export type FetchTransportOptions = {
    // Backend origin, e.g. "https://nexus-pi.tailnet.ts.net" (no /api suffix).
    origin: string;
    token: string;
    client: NexusClientName;
    timeoutMs?: number;
    fetch?: typeof fetch;
};

// Transport over fetch, for clients that talk to the backend directly.
export function fetchTransport({
    origin,
    token,
    client,
    timeoutMs = 5000,
    fetch: fetchImpl = fetch,
}: FetchTransportOptions): Transport {
    const base = `${origin.replace(/\/+$/, "")}${API_PREFIX}`;
    const headers = nexusHeaders(token, client);

    return async ({ method, path, body }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetchImpl(`${base}${path}`, {
                method,
                headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal,
            });
            const text = await res.text();
            let data: unknown = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch {
                data = text;
            }
            return res.ok ? { ok: true, data } : httpFailure(res.status, res.statusText, data);
        } catch {
            if (controller.signal.aborted) {
                return { ok: false, status: null, message: "The backend took too long to respond" };
            }
            return { ok: false, status: null, message: `Can't reach the backend at ${base}` };
        } finally {
            clearTimeout(timer);
        }
    };
}
