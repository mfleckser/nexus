import { Event } from "@renderer/types";
import { browserTimeZone } from "@renderer/lib/time";

async function getEvents(start: Date, end: Date): Promise<Event[]> {
    const qs = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString()
    });
    const raw = await window.api.apiGet(`/events?${qs.toString()}`);
    return raw.map((e: any) => ({
        ...e,
        created_at: new Date(e.created_at),
        updated_at: new Date(e.updated_at),
        start_at: new Date(e.start_at),
        end_at: new Date(e.end_at),
    }));
}

function addEvent(title: string, description: string | null, start_at: Date, end_at: Date, category: string) {
    return window.api.apiPost("/events", {
        title: title,
        description: description,
        start_at: start_at,
        end_at: end_at,
        category: category,
        timezone: browserTimeZone()
    })
}

function updateEvent(id: string, data: any) {
    return window.api.apiPut(`/events/${id}`, data);
}

function deleteEvent(id: string) {
    return window.api.apiDelete(`/events/${id}`)
}

export { getEvents, addEvent, updateEvent, deleteEvent }
