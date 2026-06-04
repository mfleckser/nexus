import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getEvents, addEvent as apiAddEvent, updateEvent as apiUpdateEvent, deleteEvent as apiDeleteEvent } from "@renderer/api/event";
import { Event } from "@renderer/types";
import { NewEventDraft } from "@renderer/pages/Home/NewEventPopover";
import useNow from "./useNow";
import { sameSet } from "./utils";

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
    getEvents().then(fresh =>
      setEvents(prev => sameSet(fresh, prev) ? prev : fresh));
  }, [now]);

  async function addEvent(draft: NewEventDraft) {
    await apiAddEvent(draft.title, draft.description, draft.start_at, new Date(draft.start_at.getTime() + draft.duration * 1000 * 60), draft.category);
    const fresh = await getEvents();
    setEvents(fresh);
  }

  async function updateEvent(id: string, data: any) {
    if (id === "DRAFT") return;
    await apiUpdateEvent(id, data);
    setEvents(prev => prev.map(e => (e.id === id ? { ...e, ...data } : e)));
  }

  async function deleteEvent(id: string) {
    await apiDeleteEvent(id);
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
