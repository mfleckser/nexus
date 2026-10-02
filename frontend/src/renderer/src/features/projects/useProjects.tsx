import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import * as projectsApi from "@renderer/features/projects/projects.api";
import { Feature, Project } from "@renderer/types";
import useNow from "@renderer/hooks/useNow";
import useReportError from "@renderer/hooks/useReportError";
import { sameSet } from "@renderer/lib/collections";

type ProjectsContextValue = {
    projects: Project[];
    // False until the first project fetch has settled.
    projectsLoaded: boolean;
    addProject: (title: string, description: string, type: string | null) => Promise<void>;
    updateProject: (id: string, data: projectsApi.ProjectUpdate) => Promise<void>;
    // Optimistic; rolls back and rethrows on failure.
    deleteProject: (id: string) => Promise<void>;

    notesByProjectId: Record<string, string>;
    loadNotes: (project_id: string) => Promise<void>;
    updateNotes: (project_id: string, notes: string) => Promise<void>;

    featuresByProjectId: Record<string, Feature[]>;
    loadFeatures: (project_id: string) => Promise<void>;
    addFeature: (project_id: string, name: string) => Promise<void>;
    // Optimistic; rolls back and rethrows on failure.
    deleteFeature: (feature_id: string) => Promise<void>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [projectsLoaded, setProjectsLoaded] = useState(false);
    const [featuresByProjectId, setFeaturesByProjectId] = useState<Record<string, Feature[]>>({});
    const [notesByProjectId, setNotesByProjectId] = useState<Record<string, string>>({});
    const now = useNow(600000);
    const reportError = useReportError();
    // Latest state, for rollback snapshots taken inside stable callbacks.
    const projectsRef = useRef(projects);
    const featuresRef = useRef(featuresByProjectId);
    useEffect(() => {
        projectsRef.current = projects;
        featuresRef.current = featuresByProjectId;
    }, [projects, featuresByProjectId]);

    useEffect(() => {
        projectsApi
            .getProjects()
            .then((fresh) => setProjects((prev) => (sameSet(fresh, prev) ? prev : fresh)))
            .catch((err) => reportError("Couldn't refresh projects", err))
            .finally(() => setProjectsLoaded(true));
    }, [now, reportError]);

    const replaceProject = useCallback((saved: Project) => {
        setProjects((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    }, []);

    const addProject = useCallback(async (title: string, description: string, type: string | null) => {
        await projectsApi.addProject(title, description, type);
        setProjects(await projectsApi.getProjects());
    }, []);

    const updateProject = useCallback(
        async (id: string, data: projectsApi.ProjectUpdate) => {
            replaceProject(await projectsApi.updateProject(id, data));
        },
        [replaceProject],
    );

    const deleteProject = useCallback(async (id: string) => {
        const snapshot = projectsRef.current;
        setProjects((prev) => prev.filter((p) => p.id !== id));
        try {
            await projectsApi.deleteProject(id);
        } catch (err) {
            const before = snapshot.find((p) => p.id === id);
            if (before) setProjects((prev) => (prev.some((p) => p.id === id) ? prev : [...prev, before]));
            throw err;
        }
    }, []);

    const loadNotes = useCallback(async (project_id: string) => {
        const notes = await projectsApi.getNotes(project_id);
        setNotesByProjectId((prev) => ({ ...prev, [project_id]: notes }));
    }, []);

    // The PUT returns the updated row, so only this project is refreshed.
    const updateNotes = useCallback(
        async (project_id: string, notes: string) => {
            const saved = await projectsApi.updateProject(project_id, { notes });
            setNotesByProjectId((prev) => ({ ...prev, [project_id]: notes }));
            replaceProject(saved);
        },
        [replaceProject],
    );

    const loadFeatures = useCallback(async (project_id: string) => {
        const features = await projectsApi.getFeatures(project_id);
        setFeaturesByProjectId((prev) => ({ ...prev, [project_id]: features }));
    }, []);

    const addFeature = useCallback(
        async (project_id: string, name: string) => {
            await projectsApi.addFeature(project_id, name);
            await loadFeatures(project_id);
        },
        [loadFeatures],
    );

    const deleteFeature = useCallback(async (feature_id: string) => {
        const snapshot = featuresRef.current;
        const project_id = Object.keys(snapshot).find((p) => snapshot[p].some((f) => f.id === feature_id));
        if (project_id) {
            setFeaturesByProjectId((prev) => ({
                ...prev,
                [project_id]: (prev[project_id] ?? []).filter((f) => f.id !== feature_id),
            }));
        }
        try {
            await projectsApi.deleteFeature(feature_id);
        } catch (err) {
            if (project_id) setFeaturesByProjectId((prev) => ({ ...prev, [project_id]: snapshot[project_id] }));
            throw err;
        }
    }, []);

    const value = useMemo(
        () => ({
            projects,
            projectsLoaded,
            addProject,
            updateProject,
            deleteProject,
            notesByProjectId,
            loadNotes,
            updateNotes,
            featuresByProjectId,
            loadFeatures,
            addFeature,
            deleteFeature,
        }),
        [
            projects,
            projectsLoaded,
            addProject,
            updateProject,
            deleteProject,
            notesByProjectId,
            loadNotes,
            updateNotes,
            featuresByProjectId,
            loadFeatures,
            addFeature,
            deleteFeature,
        ],
    );

    return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- provider and hook share the private context; HMR reloads this file fully
export function useProjects(): ProjectsContextValue {
    const ctx = useContext(ProjectsContext);
    if (!ctx) throw new Error("useProjects must be used within ProjectsProvider");
    return ctx;
}
