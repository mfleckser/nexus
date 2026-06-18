import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import * as projectsApi from "@renderer/features/projects/projects.api";
import { Feature, Project } from "@renderer/types";
import useNow from "@renderer/hooks/useNow";
import { sameSet } from "@renderer/lib/collections";

type ProjectsContextValue = {
  projects: Project[];
  addProject: (title: string, description: string, type: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  featuresByProjectId: Record<string, Feature[]>;
  loadFeatures: (project_id: string) => Promise<void>;
  addFeature: (project_id: string, name: string) => Promise<void>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [featuresByProjectId, setFeaturesByProjectId] = useState<Record<string, Feature[]>>({} as Record<string, Feature[]>);
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
    setProjects(prev => prev.filter(p => p.id !== id))
    await projectsApi.deleteProject(id);
  }

  async function loadFeatures(project_id: string) {
    const features = await projectsApi.getFeatures(project_id);
    setFeaturesByProjectId(prev => ({ ...prev, [project_id]: features }));
  }

  async function addFeature(project_id: string, name: string) {
    await projectsApi.addFeature(project_id, name);
    loadFeatures(project_id);
  }

  return (
    <ProjectsContext.Provider value={{ projects, addProject, deleteProject, featuresByProjectId, loadFeatures, addFeature }}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects must be used within ProjectsProvider");
  return ctx;
}
