import { useEffect, useState } from "react";
import { getTasks, addTask as apiAddTask } from "../api/task";

export function useTasks() {
  const [tasks, setTasks] = useState<any>([]);

  useEffect(() => {
    getTasks().then(setTasks);
  }, []);

  function addTask(title: string, description: string | null, due_at: string | null) {
    const dueDate = due_at ? new Date(due_at) : null;
    apiAddTask(title, description, dueDate);
    getTasks().then(setTasks);
  }

  return {tasks, addTask};
}