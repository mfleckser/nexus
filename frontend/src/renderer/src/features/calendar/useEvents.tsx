import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import * as eventsApi from "@renderer/features/calendar/events.api";
import { DateRange, Event, NewEventDraft, RecurrenceScope } from "@renderer/types";
import useNow from "@renderer/hooks/useNow";
import { sameSet } from "@renderer/lib/collections";

type EventsContextValue = {
  events: Event[];
  range: DateRange | null;
  setRange: (next: DateRange) => void;
  addEvent: (draft: NewEventDraft) => Promise<void>;
  updateEvent: (event: Event, data: any, scope?: RecurrenceScope) => Promise<void>;
  deleteEvent: (event: Event, scope?: RecurrenceScope) => Promise<void>;
};

const EventsContext = createContext<EventsContextValue | null>(null);

export function EventsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [range, setRangeState] = useState<DateRange | null>(null);
  const now = useNow(15000);

  // Idempotent by value: a consumer may call this on every render without
  // producing a new state object, so the fetch effect below stays stable.
  const setRange = useCallback((next: DateRange) => {
    setRangeState(prev =>
      prev &&
      prev.start.getTime() === next.start.getTime() &&
      prev.end.getTime() === next.end.getTime()
        ? prev
        : next
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
    setEvents(prev => !force && sameSet(fresh, prev) ? prev : fresh);
  }, []);

  useEffect(() => { rangeRef.current = range; }, [range]);

  useEffect(() => {
    // range null = nothing visible yet — never fetch unbounded
    loadRange(range).catch(console.error);
  }, [now, range, loadRange]);

  // After a mutation, replace state outright (sameSet can't see a failed
  // optimistic edit, since the chip's id/updated_at are unchanged).
  const refetch = () => loadRange(rangeRef.current, true);

  async function addEvent(draft: NewEventDraft) {
    await eventsApi.addEvent(draft.title, draft.description, draft.start_at, new Date(draft.start_at.getTime() + draft.duration * 1000 * 60), draft.category, draft.rrule ?? null);
    await refetch();
  }

  // Occurrences of a series (recurring_event_id set) have virtual or override
  // ids and must only ever hit the occurrence endpoints. One edit can reshape
  // many instances, so always resync the window afterwards — on failure too,
  // to roll back the optimistic change — then surface the original error.
  async function mutateOccurrence(event: Event, call: (masterId: string, originalStart: Date) => Promise<unknown>) {
    if (!event.recurring_event_id || !event.original_start_at) {
      throw new Error(`Event ${event.id} is not a recurring occurrence`);
    }
    try {
      await call(event.recurring_event_id, event.original_start_at);
    } catch (err) {
      await refetch();
      throw err;
    }
    await refetch();
  }

  async function updateEvent(event: Event, data: any, scope?: RecurrenceScope): Promise<void> {
    if (event.id === "DRAFT") return;
    setEvents(prev => prev.map(e => (e.id === event.id ? { ...e, ...data } : e)));
    if (!event.recurring_event_id) {
      await eventsApi.updateEvent(event.id, data);
      return;
    }
    // TODO(Stage 4): callers will prompt for a scope; default keeps drag/resize working until then.
    await mutateOccurrence(event, (masterId, originalStart) =>
      eventsApi.updateOccurrence(masterId, originalStart, scope ?? "this", data));
  }

  async function deleteEvent(event: Event, scope?: RecurrenceScope): Promise<void> {
    setEvents(prev => prev.filter(e => e.id !== event.id));
    if (!event.recurring_event_id) {
      await eventsApi.deleteEvent(event.id);
      return;
    }
    // TODO(Stage 4): callers will prompt for a scope; default keeps delete working until then.
    await mutateOccurrence(event, (masterId, originalStart) =>
      eventsApi.deleteOccurrence(masterId, originalStart, scope ?? "this"));
  }

  return (
    <EventsContext.Provider value={{ events, range, setRange, addEvent, updateEvent, deleteEvent }}>
      {children}
    </EventsContext.Provider>
  );
}

export function useEvents(): EventsContextValue {
  const ctx = useContext(EventsContext);
  if (!ctx) throw new Error("useEvents must be used within EventsProvider");
  return ctx;
}
