import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getProjects, addProject as apiAddProject } from "@renderer/api/projects";
import { Project } from "@renderer/types";
import useNow from "./useNow";
import { sameSet } from "./utils";

type ProjectsContextValue = {
  projects: Project[];
  addProject: (title: string, description: string, type: string) => Promise<void>;
//   updateE: (id: string, data: any) => Promise<void>;
//   deleteEvent: (id: string) => Promise<void>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const now = useNow(600000);

  useEffect(() => {
    getProjects().then(fresh =>
      setProjects(prev => sameSet(fresh, prev) ? prev : fresh));
  }, [now]);

  async function addProject(title: string, description: string, type: string) {
    await apiAddProject(title, description, type);
    const fresh = await getProjects();
    setProjects(fresh);
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
    <ProjectsContext.Provider value={{ projects, addProject }}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects must be used within ProjectsProvider");
  return ctx;
}
