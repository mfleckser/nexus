import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import * as eventsApi from "@renderer/features/calendar/events.api";
import { EventUpdate } from "@renderer/features/calendar/events.api";
import { CalendarEvent, DateRange, NewEventDraft, RecurrenceScope } from "@renderer/types";
import useNow from "@renderer/hooks/useNow";
import useReportError from "@renderer/hooks/useReportError";
import { sameSet } from "@renderer/lib/collections";

type EventsContextValue = {
    events: CalendarEvent[];
    range: DateRange | null;
    setRange: (next: DateRange) => void;
    addEvent: (draft: NewEventDraft) => Promise<void>;
    // Optimistic; roll back and rethrow on failure. `scope` is required for
    // occurrences of a series (recurring_event_id set).
    updateEvent: (event: CalendarEvent, data: EventUpdate, scope?: RecurrenceScope) => Promise<void>;
    deleteEvent: (event: CalendarEvent, scope?: RecurrenceScope) => Promise<void>;
};

const EventsContext = createContext<EventsContextValue | null>(null);

// Occurrences of a series (recurring_event_id set) have virtual or override
// ids and must only ever hit the occurrence endpoints, with the scope the
// user picked. Returns null for plain events; throws — before any optimistic
// change — if an occurrence arrives without a scope.
function occurrenceScope(event: CalendarEvent, scope: RecurrenceScope | undefined): RecurrenceScope | null {
    if (!event.recurring_event_id) return null;
    if (!scope) throw new Error(`Recurring occurrence ${event.id} needs an edit scope`);
    return scope;
}

export function EventsProvider({ children }: { children: ReactNode }) {
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [range, setRangeState] = useState<DateRange | null>(null);
    const now = useNow(15000);
    const reportError = useReportError();

    // Idempotent by value: a consumer may call this on every render without
    // producing a new state object, so the fetch effect below stays stable.
    const setRange = useCallback((next: DateRange) => {
        setRangeState((prev) =>
            prev && prev.start.getTime() === next.start.getTime() && prev.end.getTime() === next.end.getTime()
                ? prev
                : next,
        );
    }, []);

    // Every fetch takes a sequence number; only the newest one, for the range
    // that is still current, may write state. Stops a slow poll or a refetch for
    // a range the user has navigated away from from clobbering newer data.
    const rangeRef = useRef<DateRange | null>(null);
    const fetchSeqRef = useRef(0);

    const loadRange = useCallback(async (target: DateRange | null, force = false) => {
        if (!target) return;
        const seq = ++fetchSeqRef.current;
        const fresh = await eventsApi.getEvents(target.start, target.end);
        if (seq !== fetchSeqRef.current || target !== rangeRef.current) return;
        setEvents((prev) => (!force && sameSet(fresh, prev) ? prev : fresh));
    }, []);

    useEffect(() => {
        rangeRef.current = range;
    }, [range]);

    useEffect(() => {
        // range null = nothing visible yet — never fetch unbounded
        loadRange(range).catch((err) => reportError("Couldn't refresh the calendar", err));
    }, [now, range, loadRange, reportError]);

    // After a mutation, replace state outright (sameSet can't see a failed
    // optimistic edit, since the chip's id/updated_at are unchanged).
    const refetch = useCallback(() => loadRange(rangeRef.current, true), [loadRange]);

    // Undo an optimistic update/delete of `event` (the pre-change row).
    const restore = useCallback((event: CalendarEvent) => {
        setEvents((prev) =>
            prev.some((e) => e.id === event.id) ? prev.map((e) => (e.id === event.id ? event : e)) : [...prev, event],
        );
    }, []);

    // After a failed mutation: resync, or put the old row back if even that fails.
    const rollback = useCallback(
        async (event: CalendarEvent) => {
            try {
                await refetch();
            } catch {
                restore(event);
            }
        },
        [refetch, restore],
    );

    const addEvent = useCallback(
        async (draft: NewEventDraft) => {
            await eventsApi.addEvent(
                draft.title,
                draft.description,
                draft.start_at,
                new Date(draft.start_at.getTime() + draft.duration * 1000 * 60),
                draft.category,
                draft.rrule ?? null,
            );
            await refetch();
        },
        [refetch],
    );

    // One edit can reshape many instances, so always resync the window
    // afterwards — on failure too, to roll back the optimistic change — then
    // surface the original error.
    const mutateOccurrence = useCallback(
        async (event: CalendarEvent, call: (masterId: string, originalStart: Date) => Promise<unknown>) => {
            if (!event.recurring_event_id || !event.original_start_at) {
                throw new Error(`Event ${event.id} is not a recurring occurrence`);
            }
            try {
                await call(event.recurring_event_id, event.original_start_at);
            } catch (err) {
                await rollback(event);
                throw err;
            }
            await refetch();
        },
        [refetch, rollback],
    );

    const updateEvent = useCallback(
        async (event: CalendarEvent, data: EventUpdate, scope?: RecurrenceScope): Promise<void> => {
            const occScope = occurrenceScope(event, scope);
            setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, ...data } : e)));
            if (!occScope) {
                try {
                    await eventsApi.updateEvent(event.id, data);
                } catch (err) {
                    restore(event);
                    throw err;
                }
                // Adding/removing an rrule turns the row into (or out of) a series
                // whose instances have different ids — resync rather than wait for the poll.
                if ("rrule" in data) await refetch();
                return;
            }
            await mutateOccurrence(event, (masterId, originalStart) =>
                eventsApi.updateOccurrence(masterId, originalStart, occScope, data),
            );
        },
        [refetch, restore, mutateOccurrence],
    );

    const deleteEvent = useCallback(
        async (event: CalendarEvent, scope?: RecurrenceScope): Promise<void> => {
            const occScope = occurrenceScope(event, scope);
            setEvents((prev) => prev.filter((e) => e.id !== event.id));
            if (!occScope) {
                try {
                    await eventsApi.deleteEvent(event.id);
                } catch (err) {
                    restore(event);
                    throw err;
                }
                return;
            }
            await mutateOccurrence(event, (masterId, originalStart) =>
                eventsApi.deleteOccurrence(masterId, originalStart, occScope),
            );
        },
        [restore, mutateOccurrence],
    );

    const value = useMemo(
        () => ({ events, range, setRange, addEvent, updateEvent, deleteEvent }),
        [events, range, setRange, addEvent, updateEvent, deleteEvent],
    );

    return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- provider and hook share the private context; HMR reloads this file fully
export function useEvents(): EventsContextValue {
    const ctx = useContext(EventsContext);
    if (!ctx) throw new Error("useEvents must be used within EventsProvider");
    return ctx;
}
