import { createNexusClient, Transport } from "@nexus/shared";

// Requests go through the main process (window.api), which adds the backend
// origin, token and client name.
const ipcTransport: Transport = ({ method, path, body }) => {
    switch (method) {
        case "GET":
            return window.api.apiGet(path);
        case "POST":
            return window.api.apiPost(path, body);
        case "PUT":
            return window.api.apiPut(path, body);
        case "DELETE":
            return window.api.apiDelete(path);
    }
};

export const api = createNexusClient(ipcTransport);

// JSON wire form of a value: Date fields travel as ISO strings.
type WireValue<V> = V extends Date ? string : V;
type Wire<T> = { [K in keyof T]: WireValue<T[K]> };

export function toWire<T extends object>(data: T): Wire<T> {
    return Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
    ) as Wire<T>;
}

export const parseDate = (value: string): Date => new Date(value);
export const parseNullableDate = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);
