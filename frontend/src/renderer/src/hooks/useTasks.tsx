import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getTasks, addTask as apiAddTask, updateTask as apiUpdateTask, deleteTask as apiDeleteTask } from "../api/task";
import { Task } from "@renderer/types";

type TasksContextValue = {
  tasks: Task[];
  addTask: (title: string, description: string | null, due_at: string | null) => Promise<void>;
  updateTask: (id: string, data: any) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
};

const TasksContext = createContext<TasksContextValue | null>(null);

export function TasksProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    getTasks().then(setTasks);
  }, []);

  async function addTask(title: string, description: string | null, due_at: string | null) {
    const dueDate = due_at ? new Date(due_at) : null;
    await apiAddTask(title, description, dueDate);
    const fresh = await getTasks();
    setTasks(fresh);
  }

  async function updateTask(id: string, data: any) {
    await apiUpdateTask(id, data);
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...data } : t)));
  }

  async function deleteTask(id: string) {
    await apiDeleteTask(id);
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
