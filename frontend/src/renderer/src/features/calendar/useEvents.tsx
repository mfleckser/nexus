import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import * as eventsApi from "@renderer/features/calendar/events.api";
import { DateRange, Event, NewEventDraft } from "@renderer/types";
import useNow from "@renderer/hooks/useNow";
import { sameSet } from "@renderer/lib/collections";

type EventsContextValue = {
  events: Event[];
  range: DateRange | null;
  setRange: (next: DateRange) => void;
  addEvent: (draft: NewEventDraft) => Promise<void>;
  updateEvent: (id: string, data: any) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
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

  useEffect(() => {
    if (!range) return; // nothing visible yet — never fetch unbounded
    let cancelled = false;
    eventsApi.getEvents(range.start, range.end).then(fresh => {
      if (cancelled) return;
      setEvents(prev => sameSet(fresh, prev) ? prev : fresh);
    });
    return () => { cancelled = true; };
  }, [now, range]);

  async function addEvent(draft: NewEventDraft) {
    await eventsApi.addEvent(draft.title, draft.description, draft.start_at, new Date(draft.start_at.getTime() + draft.duration * 1000 * 60), draft.category);
    if (!range) return;
    const fresh = await eventsApi.getEvents(range.start, range.end);
    setEvents(fresh);
  }

  async function updateEvent(id: string, data: any) {
    if (id === "DRAFT") return;
    setEvents(prev => prev.map(e => (e.id === id ? { ...e, ...data } : e)));
    await eventsApi.updateEvent(id, data);
  }

  async function deleteEvent(id: string) {
    setEvents(prev => prev.filter(e => e.id !== id));
    await eventsApi.deleteEvent(id);
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
