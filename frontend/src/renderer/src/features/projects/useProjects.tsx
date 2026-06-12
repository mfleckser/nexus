import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import * as projectsApi from "@renderer/features/projects/projects.api";
import { Project } from "@renderer/types";
import useNow from "@renderer/hooks/useNow";
import { sameSet } from "@renderer/lib/collections";

type ProjectsContextValue = {
  projects: Project[];
  addProject: (title: string, description: string, type: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
//   updateE: (id: string, data: any) => Promise<void>;
//   deleteEvent: (id: string) => Promise<void>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const now = useNow(600000);

  useEffect(() => {
    projectsApi.getProjects().then(fresh =>
      setProjects(prev => sameSet(fresh, prev) ? prev : fresh));
  }, [now]);

  async function addProject(title: string, description: string, type: string) {
    await projectsApi.addProject(title, description, type);
    const fresh = await projectsApi.getProjects();
    setProjects(fresh);
  }

  async function deleteProject(id: string) {
    await projectsApi.deleteProject(id);
    setProjects(prev => prev.filter(p => p.id !== id))
  }

//   async function updateEvent(id: string, data: any) {
//     if (id === "DRAFT") return;
//     await apiUpdateEvent(id, data);
//     setEvents(prev => prev.map(e => (e.id === id ? { ...e, ...data } : e)));
//   }

//   async function deleteEvent(id: string) {
//     await apiDeleteEvent(id);
//     setEvents(prev => prev.filter(t => t.id !== id));
//   }

  return (
    <ProjectsContext.Provider value={{ projects, addProject, deleteProject }}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects must be used within ProjectsProvider");
  return ctx;
}
