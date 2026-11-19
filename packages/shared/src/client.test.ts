import { describe, expect, it } from "vitest";
import { ApiError, createNexusClient, fetchTransport, Transport, TransportRequest } from "./client";

function recordingTransport(data: unknown = {}) {
    const requests: TransportRequest[] = [];
    const transport: Transport = async (req) => {
        requests.push(req);
        return { ok: true, data };
    };
    return { requests, client: createNexusClient(transport) };
}

describe("createNexusClient", () => {
    it("builds API-relative paths, bodies and query strings", async () => {
        const { requests, client } = recordingTransport();
        await client.listTasks({ status: "todo,blocked" });
        await client.listTasks();
        await client.updateTask("t1", { status: "complete" });
        await client.listEvents({ start: "2026-09-27T07:00:00.000Z", end: "2026-10-04T07:00:00.000Z" });
        await client.createFeature("p1", { name: "Mobile" });
        expect(requests).toEqual([
            { method: "GET", path: "/tasks?status=todo%2Cblocked", body: undefined },
            { method: "GET", path: "/tasks", body: undefined },
            { method: "PUT", path: "/tasks/t1", body: { status: "complete" } },
            {
                method: "GET",
                path: "/events?start=2026-09-27T07%3A00%3A00.000Z&end=2026-10-04T07%3A00%3A00.000Z",
                body: undefined,
            },
            { method: "POST", path: "/projects/p1/features", body: { name: "Mobile" } },
        ]);
    });

    it("addresses occurrences by encoded original start, with the scope", async () => {
        const { requests, client } = recordingTransport();
        const start = "2026-09-30T17:00:00+00:00";
        await client.updateOccurrence("m1", start, "following", { title: "Moved" });
        await client.deleteOccurrence("m1", start, "this");
        expect(requests).toEqual([
            {
                method: "PUT",
                path: "/events/m1/occurrences/2026-09-30T17%3A00%3A00%2B00%3A00",
                body: { title: "Moved", scope: "following" },
            },
            {
                method: "DELETE",
                path: "/events/m1/occurrences/2026-09-30T17%3A00%3A00%2B00%3A00?scope=this",
                body: undefined,
            },
        ]);
    });

    it("returns the response data and throws ApiError on failure", async () => {
        const { client } = recordingTransport([{ id: "t1" }]);
        expect(await client.listTasks()).toEqual([{ id: "t1" }]);

        const failing = createNexusClient(async () => ({ ok: false, status: 404, message: "Task not found" }));
        const err = await failing.getTask("nope").catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ApiError);
        expect(err).toMatchObject({ message: "Task not found", status: 404 });
    });
});

describe("fetchTransport", () => {
    type Call = { url: string; init: RequestInit };

    function fakeFetch(respond: () => Response | Promise<Response>) {
        const calls: Call[] = [];
        const impl = (async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return respond();
        }) as typeof fetch;
        return { calls, impl };
    }

    const options = { origin: "https://pi.example/", token: "secret", client: "mobile" as const };

    it("sends to /api/v1 with the token, client and JSON body", async () => {
        const { calls, impl } = fakeFetch(() => Response.json({ id: "t1" }, { status: 201 }));
        const transport = fetchTransport({ ...options, fetch: impl });
        expect(await transport({ method: "POST", path: "/tasks", body: { title: "x" } })).toEqual({
            ok: true,
            data: { id: "t1" },
        });
        expect(calls[0].url).toBe("https://pi.example/api/v1/tasks");
        expect(calls[0].init).toMatchObject({
            method: "POST",
            body: '{"title":"x"}',
            headers: {
                Authorization: "Bearer secret",
                "X-Nexus-Client": "mobile",
                "Content-Type": "application/json",
            },
        });
    });

    it("reports the backend's error message, else the status line", async () => {
        const withMessage = fetchTransport({
            ...options,
            fetch: fakeFetch(() => Response.json({ error: "title is required" }, { status: 400 })).impl,
        });
        expect(await withMessage({ method: "GET", path: "/tasks" })).toEqual({
            ok: false,
            status: 400,
            message: "title is required",
        });

        const bare = fetchTransport({
            ...options,
            fetch: fakeFetch(() => new Response("oops", { status: 502, statusText: "Bad Gateway" })).impl,
        });
        expect(await bare({ method: "GET", path: "/tasks" })).toEqual({
            ok: false,
            status: 502,
            message: "Request failed (502 Bad Gateway)",
        });
    });

    it("reports an unreachable backend and a timeout with a null status", async () => {
        const down = fetchTransport({
            ...options,
            fetch: fakeFetch(() => Promise.reject(new TypeError("fetch failed"))).impl,
        });
        expect(await down({ method: "GET", path: "/tasks" })).toEqual({
            ok: false,
            status: null,
            message: "Can't reach the backend at https://pi.example/api/v1",
        });

        const slow = fetchTransport({
            ...options,
            timeoutMs: 10,
            fetch: ((_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
                })) as typeof fetch,
        });
        expect(await slow({ method: "GET", path: "/tasks" })).toEqual({
            ok: false,
            status: null,
            message: "The backend took too long to respond",
        });
    });
});
