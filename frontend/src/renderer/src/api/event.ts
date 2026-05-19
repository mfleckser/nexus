import { Event } from "@renderer/types";

async function getEvents(): Promise<Event[]> {
    const raw = await window.api.apiGet("/events");
    return raw.map((e: any) => ({
        ...e,
        created_at: new Date(e.created_at),
        updated_at: new Date(e.updated_at),
        start_at: new Date(e.start_at),
        end_at: new Date(e.end_at),
    }));
}

function updateEvent(id: string, data: any) {
    return window.api.apiPut(`/event/${id}`, data);
}

export { getEvents, updateEvent }