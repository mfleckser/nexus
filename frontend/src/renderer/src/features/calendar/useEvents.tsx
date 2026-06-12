import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import * as eventsApi from "@renderer/features/calendar/events.api";
import { Event, NewEventDraft } from "@renderer/types";
import useNow from "@renderer/hooks/useNow";
import { sameSet } from "@renderer/lib/collections";

type EventsContextValue = {
  events: Event[];
  addEvent: (draft: NewEventDraft) => Promise<void>;
  updateEvent: (id: string, data: any) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
};

const EventsContext = createContext<EventsContextValue | null>(null);

export function EventsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<Event[]>([]);
  const now = useNow(15000);

  useEffect(() => {
    eventsApi.getEvents().then(fresh =>
      setEvents(prev => sameSet(fresh, prev) ? prev : fresh));
  }, [now]);

  async function addEvent(draft: NewEventDraft) {
    await eventsApi.addEvent(draft.title, draft.description, draft.start_at, new Date(draft.start_at.getTime() + draft.duration * 1000 * 60), draft.category);
    const fresh = await eventsApi.getEvents();
    setEvents(fresh);
  }

  async function updateEvent(id: string, data: any) {
    if (id === "DRAFT") return;
    await eventsApi.updateEvent(id, data);
    setEvents(prev => prev.map(e => (e.id === id ? { ...e, ...data } : e)));
  }

  async function deleteEvent(id: string) {
    await eventsApi.deleteEvent(id);
    setEvents(prev => prev.filter(e => e.id !== id));
  }

  return (
    <EventsContext.Provider value={{ events, addEvent, updateEvent, deleteEvent }}>
      {children}
    </EventsContext.Provider>
  );
}

export function useEvents(): EventsContextValue {
  const ctx = useContext(EventsContext);
  if (!ctx) throw new Error("useEvents must be used within EventsProvider");
  return ctx;
}
