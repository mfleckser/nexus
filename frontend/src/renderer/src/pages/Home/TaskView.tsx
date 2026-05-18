import "./taskview.css"
import { useTasks } from "../../hooks/useTasks"
import { useEffect, useState } from "react";
import { Task } from "@renderer/types";

const pad = (n: number) => String(n).padStart(2, "0");

function toDatetimeLocal(value: Date | string | null): string {
    if (!value) return "";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDueDisplay(value: Date | string | null): string {
    if (!value) return "No due date";
    const d = new Date(value);
    if (isNaN(d.getTime())) return "No due date";
    return d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

type TaskRowProps = {
    task: Task;
    expanded: boolean;
    onToggle: () => void;
    onStatusChange: (status: string) => void;
    onSave: (data: { title: string; description: string | null; due_at: string | null }) => void;
    onDelete: () => void;
};

function TaskRow({ task, expanded, onToggle, onStatusChange, onSave, onDelete }: TaskRowProps): React.JSX.Element {
    const [editing, setEditing] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description ?? "");
    const [dueAt, setDueAt] = useState(toDatetimeLocal(task.due_at));

    useEffect(() => {
        if (!expanded) {
            setEditing(false);
            setConfirmDelete(false);
        }
    }, [expanded]);

    useEffect(() => {
        setTitle(task.title);
        setDescription(task.description ?? "");
        setDueAt(toDatetimeLocal(task.due_at));
    }, [task.id, task.title, task.description, task.due_at]);

    const done = task.status === "complete";

    const handleCheck = (e: React.MouseEvent) => {
        e.stopPropagation();
        onStatusChange(done ? "todo" : "complete");
    };

    const handleStartEdit = () => {
        setTitle(task.title);
        setDescription(task.description ?? "");
        setDueAt(toDatetimeLocal(task.due_at));
        setEditing(true);
        setConfirmDelete(false);
    };

    const handleCancelEdit = () => {
        setEditing(false);
    };

    const handleSave = () => {
        if (!title.trim()) return;
        onSave({
            title: title.trim(),
            description: description.trim() ? description.trim() : null,
            due_at: dueAt ? dueAt : null,
        });
        setEditing(false);
    };

    const handleDeleteClick = () => {
        if (confirmDelete) {
            onDelete();
        } else {
            setConfirmDelete(true);
        }
    };

    return (
        <div className={`task-row${done ? " done" : ""}${expanded ? " expanded" : ""}`}>
            <div className="task-row-header" onClick={onToggle}>
                <span className="task-check" aria-hidden onClick={handleCheck} />
                <span className="task-label">{task.title}</span>
            </div>
            {expanded && (
                <div className="task-row-details" onClick={(e) => e.stopPropagation()}>
                    {editing ? (
                        <>
                            <input
                                className="task-form-input"
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="Task title"
                                autoFocus
                            />
                            <textarea
                                className="task-form-input task-form-textarea"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Description"
                                rows={3}
                            />
                            <label className="task-form-field">
                                <span className="task-form-label">Due</span>
                                <input
                                    className="task-form-input task-form-datetime"
                                    type="datetime-local"
                                    value={dueAt}
                                    onChange={(e) => setDueAt(e.target.value)}
                                />
                            </label>
                            <div className="task-row-actions">
                                <button
                                    type="button"
                                    className="task-form-btn task-form-btn-secondary"
                                    onClick={handleCancelEdit}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="task-form-btn task-form-btn-primary"
                                    onClick={handleSave}
                                    disabled={!title.trim()}
                                >
                                    Save
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="task-detail-field">
                                <span className="task-detail-label">Description</span>
                                <p className={`task-detail-value${task.description ? "" : " muted"}`}>
                                    {task.description || "No description"}
                                </p>
                            </div>
                            <div className="task-detail-field">
                                <span className="task-detail-label">Due</span>
                                <p className={`task-detail-value${task.due_at ? "" : " muted"}`}>
                                    {formatDueDisplay(task.due_at)}
                                </p>
                            </div>
                            <div className="task-row-actions">
                                <button
                                    type="button"
                                    className={`task-form-btn task-form-btn-danger${confirmDelete ? " armed" : ""}`}
                                    onClick={handleDeleteClick}
                                    onBlur={() => setConfirmDelete(false)}
                                >
                                    {confirmDelete ? "Confirm delete?" : "Delete"}
                                </button>
                                <button
                                    type="button"
                                    className="task-form-btn task-form-btn-secondary"
                                    onClick={handleStartEdit}
                                >
                                    Edit
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

type TaskGroupProps = {
    name: string;
    filterFunc: (t: Task) => boolean;
    expandedId: string | null;
    setExpandedId: (id: string | null) => void;
};

function TaskGroup({ name, filterFunc, expandedId, setExpandedId }: TaskGroupProps): React.JSX.Element {
    const { tasks, updateTask, deleteTask } = useTasks();
    const [showTasks, setShowTasks] = useState(true);

    const compareTasks = (a: Task, b: Task) => {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    }

    const filtered = tasks.filter(filterFunc).toSorted(compareTasks);

    return (
        <div className={`task-group${showTasks ? "" : " collapsed"}`}>
            <button
                type="button"
                className="task-group-toggle"
                aria-expanded={showTasks}
                onClick={() => setShowTasks(prev => !prev)}
            >
                <span className="task-group-caret" aria-hidden />
                <span className="task-group-name">{name}</span>
                <span className="task-group-count">{filtered.length}</span>
            </button>
            {showTasks && (
                <div className="task-group-list">
                    {filtered.map(t => (
                        <TaskRow
                            key={t.id}
                            task={t}
                            expanded={expandedId === t.id}
                            onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                            onStatusChange={(status) => updateTask(t.id, { status })}
                            onSave={(data) => updateTask(t.id, data)}
                            onDelete={() => {
                                deleteTask(t.id);
                                setExpandedId(null);
                            }}
                        />
                    ))}
                    {filtered.length === 0 && (
                        <div className="task-group-empty">No tasks</div>
                    )}
                </div>
            )}
        </div>
    )
}

function TaskView(): React.JSX.Element {
    const { tasks, addTask } = useTasks();
    const [showForm, setShowForm] = useState(false);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [dueAt, setDueAt] = useState("");
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const resetForm = () => {
        setTitle("");
        setDescription("");
        setDueAt("");
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;
        addTask(title, description, dueAt);
        resetForm();
        setShowForm(false);
    };

    const handleCancel = () => {
        resetForm();
        setShowForm(false);
        console.log(tasks);
    };

    const getDaysDiff = (task: Task) => {
        if (task.due_at === null) return 0;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const due = new Date(task.due_at); due.setHours(0, 0, 0, 0);
        const diff = (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
        return diff;
    }

    return (
        <div id="task-container">
            <div id="task-panel">
                <div className="task-header">
                    <span className="task-title">Tasks</span>
                    <button
                        className="task-add"
                        aria-label={showForm ? "Close add task" : "Add task"}
                        onClick={() => setShowForm((v) => !v)}
                    >
                        {showForm ? "×" : "+"}
                    </button>
                </div>
                {showForm && (
                    <form className="task-form" onSubmit={handleSubmit}>
                        <input
                            className="task-form-input"
                            type="text"
                            placeholder="Task title"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            autoFocus
                            required
                        />
                        <textarea
                            className="task-form-input task-form-textarea"
                            placeholder="Description (optional)"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
                        />
                        <label className="task-form-field">
                            <span className="task-form-label">Due</span>
                            <input
                                className="task-form-input task-form-datetime"
                                type="datetime-local"
                                value={dueAt}
                                onChange={(e) => setDueAt(e.target.value)}
                            />
                        </label>
                        <div className="task-form-actions">
                            <button
                                type="button"
                                className="task-form-btn task-form-btn-secondary"
                                onClick={handleCancel}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="task-form-btn task-form-btn-primary"
                                disabled={!title.trim()}
                            >
                                Add
                            </button>
                        </div>
                    </form>
                )}
                <div className="task-list themed-scroll">
                    <TaskGroup
                        name="Overdue"
                        filterFunc={t => t.due_at !== null && getDaysDiff(t) < 0}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                    />
                    <TaskGroup
                        name="Today"
                        filterFunc={t => t.due_at !== null && getDaysDiff(t) === 0}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                    />
                    <TaskGroup
                        name="This Week"
                        filterFunc={t => {if (t.due_at === null) return false; const diff = getDaysDiff(t); return diff >= 1 && diff <= 7;}}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                    />
                    <TaskGroup
                        name="Future"
                        filterFunc={t => getDaysDiff(t) > 7}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                    />
                    <TaskGroup
                        name="No Due Date"
                        filterFunc={t => t.due_at === null}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                    />
                </div>
            </div>
        </div>
    );
}

export default TaskView
