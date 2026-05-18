import { useEffect, useState } from "react";
import { getTasks, addTask as apiAddTask, updateTask as apiUpdateTask } from "../api/task";

export function useTasks() {
  const [tasks, setTasks] = useState<any[]>([]);

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

  return {tasks, addTask, updateTask};
}