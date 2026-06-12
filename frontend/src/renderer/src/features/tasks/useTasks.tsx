import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import * as tasksApi from "@renderer/features/tasks/tasks.api";
import { Task } from "@renderer/types";
import useNow from "@renderer/hooks/useNow";
import { sameSet } from "@renderer/lib/collections";

type TasksContextValue = {
  tasks: Task[];
  addTask: (title: string, description: string | null, due_at: string | null) => Promise<void>;
  updateTask: (id: string, data: any) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
};

const TasksContext = createContext<TasksContextValue | null>(null);

export function TasksProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const now = useNow(15000);

  useEffect(() => {
    tasksApi.getTasks().then(fresh =>
      setTasks(prev => sameSet(fresh, prev) ? prev : fresh));
  }, [now]);

  async function addTask(title: string, description: string | null, due_at: string | null) {
    const dueDate = due_at ? new Date(due_at) : null;
    await tasksApi.addTask(title, description, dueDate);
    const fresh = await tasksApi.getTasks();
    setTasks(fresh);
  }

  async function updateTask(id: string, data: any) {
    await tasksApi.updateTask(id, data);
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...data } : t)));
  }

  async function deleteTask(id: string) {
    await tasksApi.deleteTask(id);
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  return (
    <TasksContext.Provider value={{ tasks, addTask, updateTask, deleteTask }}>
      {children}
    </TasksContext.Provider>
  );
}

export function useTasks(): TasksContextValue {
  const ctx = useContext(TasksContext);
  if (!ctx) throw new Error("useTasks must be used within TasksProvider");
  return ctx;
}
