import { useState } from "react";
import "./kanbanBoard.css";
import TaskForm from "@renderer/components/TaskForm";
import { useTasks } from "../tasks/useTasks";
import { Task } from "@renderer/types";
import TaskCard from "./TaskCard";

const STATUSES = [
    { key: "todo", label: "To Do" },
    { key: "active", label: "Active" },
    { key: "complete", label: "Complete" },
];

function KanbanBoard({ project_id } : {project_id: string}): React.JSX.Element {
    const [showTaskForm, setShowTaskForm] = useState(false);

    const {tasks, addTask, updateTask} = useTasks();
    const projectTasks = tasks.filter(t => t.project_id === project_id);

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

    return (
        <div className="kanban-container">
            <div className="kanban-header">
                <span className="kanban-title">Tasks</span>
            </div>
            <div className="kb-board">
                <div className="kb-grid">
                    <div className="kb-corner" />
                    {STATUSES.map(s => <div key={s.key} className="kb-status-header">{s.label}</div>)}

                    <div className="kb-feature-label">
                        <span className="kb-feature-name">General</span>
                        {showTaskForm ?
                            <div className="kb-task-form-wrapper"><TaskForm
                                submitLabel="Add"
                                onSubmit={({title, description, dueAt}) => {addTask(title, description, dueAt, project_id); setShowTaskForm(false);}}
                                onCancel={() => {setShowTaskForm(false)}}
                            /></div> : <button type="button" className="kb-add-task-btn" onClick={() => {setShowTaskForm(true)}}>+ Add task</button>}
                    </div>
                    {STATUSES.map(s => (
                        <div
                            key={s.key}
                            className={`kb-cell${dragOverCol === s.key ? " kb-cell-dragover" : ""}`}
                            onDragOver={(e) => { e.preventDefault(); setDragOverCol(s.key); }}
                            onDrop={() => handleDrop()}
                        >
                            {projectTasks.filter(t => statusOf(t) === s.key).map(t => (
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
                </div>
                <button type="button" className="kb-add-feature-btn">+ Add feature</button>
            </div>
        </div>
    )
}

export default KanbanBoard;
