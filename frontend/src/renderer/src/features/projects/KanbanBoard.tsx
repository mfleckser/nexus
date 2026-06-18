import { Fragment, useEffect, useState } from "react";
import "./kanbanBoard.css";
import TaskForm from "@renderer/components/TaskForm";
import { useTasks } from "../tasks/useTasks";
import { Project, Task } from "@renderer/types";
import TaskCard from "./TaskCard";
import { useProjects } from "./useProjects";

const STATUSES = [
    { key: "todo", label: "To Do" },
    { key: "active", label: "Active" },
    { key: "complete", label: "Complete" },
];

// "general" is the synthetic row for tasks with no feature_id; it always sorts first.
const GENERAL_ROW = "general";

function KanbanBoard({ project } : {project: Project}): React.JSX.Element {
    const [formRow, setFormRow] = useState<string | null>(null);
    const [featureInput, setFeatureInput] = useState<string>("");
    const [showFeatureInput, setShowFeatureInput] = useState<boolean>(false);
    const { featuresByProjectId, loadFeatures, addFeature } = useProjects();
    const {tasks, addTask, updateTask} = useTasks();
    const projectTasks = tasks.filter(t => t.project_id === project.id);
    const features = featuresByProjectId[project.id] ?? [];

    useEffect(() => {
        loadFeatures(project.id);
    }, [project.id]);

    const rows = [
        { key: GENERAL_ROW, name: "General", featureId: null as string | null },
        ...features.map(f => ({ key: f.id, name: f.name, featureId: f.id as string | null })),
    ];

    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragOverCol, setDragOverCol] = useState<string | null>(null);

    const statusOf = (t: Task) => {
        return STATUSES.some(s => s.key === t.status) ? t.status : "todo";
    };

    const handleDrop = () => {
        if (!draggingId) return;
        updateTask(draggingId, {status: dragOverCol});
        setDraggingId(null);
        setDragOverCol(null);
    };

    const handleAddFeature = () => {
        const name = featureInput.trim();
        if (!name) return;
        addFeature(project.id, name);
        setFeatureInput("");
        setShowFeatureInput(false);
    };

    const handleCancelFeature = () => {
        setFeatureInput("");
        setShowFeatureInput(false);
    };

    return (
        <div className="kanban-container">
            <div className="kanban-header">
                <span className="kanban-title">Tasks</span>
            </div>
            <div className="kb-board themed-scroll">
                <div className="kb-grid">
                    <div className="kb-corner" />
                    {STATUSES.map(s => <div key={s.key} className="kb-status-header">{s.label}</div>)}

                    {rows.map(row => {
                        const rowTasks = projectTasks.filter(t => t.feature_id === row.featureId);
                        return (
                            <Fragment key={row.key}>
                                <div className="kb-feature-label">
                                    <span className="kb-feature-name">{row.name}</span>
                                    {formRow === row.key ?
                                        <div className="kb-task-form-wrapper"><TaskForm
                                            submitLabel="Add"
                                            onSubmit={({title, description, dueAt}) => {addTask(title, description, dueAt, project.id, row.featureId ?? undefined); setFormRow(null);}}
                                            onCancel={() => {setFormRow(null)}}
                                        /></div> : <button type="button" className="kb-add-task-btn" onClick={() => {setFormRow(row.key)}}>+ Add task</button>}
                                </div>
                                {STATUSES.map(s => (
                                    <div
                                        key={s.key}
                                        className={`kb-cell${dragOverCol === s.key ? " kb-cell-dragover" : ""}`}
                                        onDragOver={(e) => { e.preventDefault(); setDragOverCol(s.key); }}
                                        onDrop={() => handleDrop()}
                                    >
                                        {rowTasks.filter(t => statusOf(t) === s.key).map(t => (
                                            <TaskCard
                                                key={t.id}
                                                task={t}
                                                dragging={draggingId === t.id}
                                                onDragStart={() => setDraggingId(t.id)}
                                                onDragEnd={() => { setDraggingId(null); setDragOverCol(null); }}
                                                onEdit={() => {}}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </Fragment>
                        );
                    })}
                </div>
                {showFeatureInput ?
                    <form className="kb-feature-form" onSubmit={(e) => { e.preventDefault(); handleAddFeature(); }}>
                        <input
                            type="text"
                            className="kb-feature-input"
                            placeholder="Feature name"
                            value={featureInput}
                            onChange={(e) => setFeatureInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Escape") handleCancelFeature(); }}
                            autoFocus
                        />
                        <button type="submit" className="kb-feature-btn kb-feature-btn-primary" disabled={!featureInput.trim()}>Add</button>
                        <button type="button" className="kb-feature-btn kb-feature-btn-secondary" onClick={handleCancelFeature}>Cancel</button>
                    </form>
                    : <button type="button" className="kb-add-feature-btn" onClick={() => setShowFeatureInput(true)}>+ Add feature</button>
                }
            </div>
        </div>
    )
}

export default KanbanBoard;
