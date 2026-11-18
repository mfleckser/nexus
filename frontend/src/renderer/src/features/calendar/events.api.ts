import { CalendarEvent, NewEventDraft, RecurrenceScope } from "@renderer/types";
import { browserTimeZone } from "@renderer/lib/time";
import { api, parseDate, parseNullableDate, Wire } from "@renderer/lib/api";

// Fields a PUT may change. Dates go over IPC as Date objects and reach the
// backend as ISO strings.
export type EventUpdate = Partial<{
    title: string;
    description: string | null;
    start_at: Date;
    end_at: Date;
    all_day: boolean;
    category: string | null;
    rrule: string | null;
    timezone: string;
}>;

function parseEvent(e: Wire<CalendarEvent>): CalendarEvent {
    return {
        ...e,
        created_at: parseDate(e.created_at),
        updated_at: parseDate(e.updated_at),
        start_at: parseDate(e.start_at),
        end_at: parseDate(e.end_at),
        rrule: e.rrule ?? null,
        recurring_event_id: e.recurring_event_id ?? null,
        original_start_at: parseNullableDate(e.original_start_at),
    };
}

async function getEvents(start: Date, end: Date): Promise<CalendarEvent[]> {
    const qs = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
    });
    const raw = await api.get<Wire<CalendarEvent>[]>(`/events?${qs.toString()}`);
    return raw.map(parseEvent);
}

// Resolves to the created row (a series master when rrule is set).
async function addEvent(draft: NewEventDraft): Promise<CalendarEvent> {
    const created = await api.post<Wire<CalendarEvent>>("/events", {
        title: draft.title,
        description: draft.description,
        start_at: draft.start_at,
        end_at: draft.end_at,
        all_day: draft.all_day,
        category: draft.category,
        timezone: browserTimeZone(),
        ...(draft.rrule ? { rrule: draft.rrule } : {}),
    });
    return parseEvent(created);
}

function updateEvent(id: string, data: EventUpdate): Promise<unknown> {
    return api.put(`/events/${id}`, data);
}

function deleteEvent(id: string): Promise<unknown> {
    return api.delete(`/events/${id}`);
}

const occurrencePath = (masterId: string, originalStart: Date): string =>
    `/events/${masterId}/occurrences/${encodeURIComponent(originalStart.toISOString())}`;

function updateOccurrence(
    masterId: string,
    originalStart: Date,
    scope: RecurrenceScope,
    data: EventUpdate,
): Promise<unknown> {
    return api.put(occurrencePath(masterId, originalStart), { ...data, scope });
}

function deleteOccurrence(masterId: string, originalStart: Date, scope: RecurrenceScope): Promise<unknown> {
    const qs = new URLSearchParams({ scope });
    return api.delete(`${occurrencePath(masterId, originalStart)}?${qs.toString()}`);
}

export { getEvents, addEvent, updateEvent, deleteEvent, updateOccurrence, deleteOccurrence };
