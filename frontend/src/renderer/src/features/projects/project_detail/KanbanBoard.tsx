import { Fragment, useEffect, useState } from "react";
import "./kanbanBoard.css";
import TaskForm from "@renderer/components/TaskForm";
import { useTasks } from "../../tasks/useTasks";
import { Project, Task } from "@renderer/types";
import TaskCard from "./TaskCard";
import FeatureLabel from "./FeatureLabel";
import { useProjects } from "../useProjects";

const STATUSES = [
    { key: "todo", label: "To Do" },
    { key: "active", label: "Active" },
    { key: "complete", label: "Complete" },
];

// "general" is the synthetic row for tasks with no feature_id; it always sorts first.
const GENERAL_ROW = "general";

// Format a Date into the local "YYYY-MM-DDTHH:mm" string a datetime-local input expects.
function toDatetimeLocal(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function KanbanBoard({ project } : {project: Project}): React.JSX.Element {
    const [formRow, setFormRow] = useState<string | null>(null);
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

    const [featureInput, setFeatureInput] = useState<string>("");
    const [showFeatureInput, setShowFeatureInput] = useState<boolean>(false);

    const { featuresByProjectId, loadFeatures, addFeature, deleteFeature } = useProjects();
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
    type DropTarget = { status: string, feature_id: string | null };
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

    const statusOf = (t: Task) => {
        return STATUSES.some(s => s.key === t.status) ? t.status : "todo";
    };

    const handleDrop = () => {
        if (!draggingId || !dropTarget) return;

        const draggedTask = projectTasks.find(t => t.id === draggingId);
        if (!draggedTask) return;
        if (draggedTask.status !== dropTarget.status || draggedTask.feature_id !== dropTarget?.feature_id)
            updateTask(draggingId, dropTarget);

        setDraggingId(null);
        setDropTarget(null);
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
                                    <FeatureLabel
                                        name={row.name}
                                        featureId={row.featureId}
                                        onEdit={() => {}}
                                        onDelete={() => { if (row.featureId) deleteFeature(row.featureId); }}
                                    />
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
                                        className={`kb-cell${dropTarget?.feature_id === row.featureId && dropTarget.status === s.key ? " kb-cell-dragover" : ""}`}
                                        onDragOver={(e) => { e.preventDefault(); setDropTarget({ status: s.key, feature_id: row.featureId }); }}
                                        onDrop={() => handleDrop()}
                                    >
                                        {rowTasks.filter(t => statusOf(t) === s.key).map(t => (
                                            editingTaskId === t.id ?
                                                <div key={t.id} className="kb-task-edit-wrapper"><TaskForm
                                                    submitLabel="Save"
                                                    initialTitle={t.title}
                                                    initialDescription={t.description ?? ""}
                                                    initialDueAt={t.due_at ? toDatetimeLocal(t.due_at) : ""}
                                                    onSubmit={({title, description, dueAt}) => {
                                                        updateTask(t.id, { title, description, due_at: dueAt ? new Date(dueAt) : null });
                                                        setEditingTaskId(null);
                                                    }}
                                                    onCancel={() => setEditingTaskId(null)}
                                                /></div> :
                                                <TaskCard
                                                    key={t.id}
                                                    task={t}
                                                    dragging={draggingId === t.id}
                                                    onDragStart={() => setDraggingId(t.id)}
                                                    onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
                                                    onEdit={() => setEditingTaskId(t.id)}
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
