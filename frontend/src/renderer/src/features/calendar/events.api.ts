import type { Event as ApiEvent } from "@nexus/shared";
import { CalendarEvent, NewEventDraft, RecurrenceScope } from "@renderer/types";
import { browserTimeZone } from "@renderer/lib/time";
import { api, parseDate, parseNullableDate, toWire } from "@renderer/lib/api";

// Fields a PUT may change. Dates reach the backend as ISO strings.
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

function parseEvent(e: ApiEvent): CalendarEvent {
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
    const raw = await api.listEvents({ start: start.toISOString(), end: end.toISOString() });
    return raw.map(parseEvent);
}

// Resolves to the created row (a series master when rrule is set).
async function addEvent(draft: NewEventDraft): Promise<CalendarEvent> {
    const created = await api.createEvent(
        toWire({
            title: draft.title,
            description: draft.description,
            start_at: draft.start_at,
            end_at: draft.end_at,
            all_day: draft.all_day,
            category: draft.category,
            timezone: browserTimeZone(),
            ...(draft.rrule ? { rrule: draft.rrule } : {}),
        }),
    );
    return parseEvent(created);
}

function updateEvent(id: string, data: EventUpdate): Promise<unknown> {
    return api.updateEvent(id, toWire(data));
}

function deleteEvent(id: string): Promise<unknown> {
    return api.deleteEvent(id);
}

function updateOccurrence(
    masterId: string,
    originalStart: Date,
    scope: RecurrenceScope,
    data: EventUpdate,
): Promise<unknown> {
    return api.updateOccurrence(masterId, originalStart.toISOString(), scope, toWire(data));
}

function deleteOccurrence(masterId: string, originalStart: Date, scope: RecurrenceScope): Promise<unknown> {
    return api.deleteOccurrence(masterId, originalStart.toISOString(), scope);
}

export { getEvents, addEvent, updateEvent, deleteEvent, updateOccurrence, deleteOccurrence };
