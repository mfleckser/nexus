import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getEvents } from "@renderer/api/event";
import { Event } from "@renderer/types";

type EventsContextValue = {
  events: Event[];
  addEvent: (title: string, description: string | null, due_at: string | null) => Promise<void>;
  updateEvent: (id: string, data: any) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
};

const EventsContext = createContext<EventsContextValue | null>(null);

export function EventsProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    getEvents().then(setEvents);
  }, []);

  async function addEvent(title: string, description: string | null, due_at: string | null) {
    // const dueDate = due_at ? new Date(due_at) : null;
    // await apiAddTask(title, description, dueDate);
    // const fresh = await getTasks();
    // setTasks(fresh);
  }

  async function updateEvent(id: string, data: any) {
    // await apiUpdateTask(id, data);
    // setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...data } : t)));
  }

  async function deleteEvent(id: string) {
    // await apiDeleteTask(id);
    // setTasks(prev => prev.filter(t => t.id !== id));
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
