import "./taskView.css";
import { useTasks } from "@renderer/features/tasks/useTasks";
import { useProjects } from "@renderer/features/projects/useProjects";
import { useState } from "react";
import { Task, TaskStatus } from "@renderer/types";
import useNow from "@renderer/hooks/useNow";
import TaskForm from "@renderer/components/TaskForm";
import { calendarDaysBetween, formatDueDisplay, toDatetimeLocal } from "@renderer/lib/time";
import useReportError from "@renderer/hooks/useReportError";

type TaskRowProps = {
    task: Task;
    expanded: boolean;
    onToggle: () => void;
    onStatusChange: (status: TaskStatus) => void;
    onSave: (data: { title: string; description: string | null; due_at: string | null }) => void;
    onDelete: () => void;
};

function TaskRow({ task, expanded, onToggle, onStatusChange, onSave, onDelete }: TaskRowProps): React.JSX.Element {
    // Derived, not cached: the calendar can toggle the same task.
    const complete = task.status === "complete";

    return (
        <div className={`task-row${complete ? " done" : ""}${expanded ? " expanded" : ""}`}>
            <div
                className="task-row-header"
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={onToggle}
                onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    onToggle();
                }}
            >
                <button
                    type="button"
                    className="task-check"
                    aria-label={complete ? "Mark incomplete" : "Mark complete"}
                    aria-pressed={complete}
                    onClick={(e) => {
                        e.stopPropagation();
                        onStatusChange(complete ? "todo" : "complete");
                    }}
                />
                <span className="task-label">{task.title}</span>
            </div>
            {/* Mounted only while expanded, so edit/confirm state resets on collapse. */}
            {expanded && <TaskRowContents task={task} onSave={onSave} onDelete={onDelete} />}
        </div>
    );
}

function TaskRowContents({ task, onSave, onDelete }: Pick<TaskRowProps, "task" | "onSave" | "onDelete">) {
    const [editing, setEditing] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const handleStartEdit = () => {
        setEditing(true);
        setConfirmDelete(false);
    };

    const handleDeleteClick = () => {
        if (confirmDelete) {
            onDelete();
        } else {
            setConfirmDelete(true);
        }
    };

    return (
        <div className="task-row-contents" onClick={(e) => e.stopPropagation()}>
            {editing ? (
                <TaskForm
                    submitLabel="Save"
                    initialTitle={task.title}
                    initialDescription={task.description ?? ""}
                    initialDueAt={toDatetimeLocal(task.due_at)}
                    onSubmit={(v) => {
                        onSave({ title: v.title, description: v.description, due_at: v.dueAt });
                        setEditing(false);
                    }}
                    onCancel={() => setEditing(false)}
                />
            ) : (
                <div className="task-row-details">
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
    startClosed?: boolean;
};

function TaskGroup({
    name,
    filterFunc,
    expandedId,
    setExpandedId,
    startClosed = false,
}: TaskGroupProps): React.JSX.Element {
    const { tasks, updateTask, deleteTask } = useTasks();
    const reportError = useReportError();
    const [showTasks, setShowTasks] = useState(!startClosed);

    const filtered = tasks.filter(filterFunc).toSorted((a, b) => a.created_at.getTime() - b.created_at.getTime());

    return (
        <div className={`task-group${showTasks ? "" : " collapsed"}`}>
            <button
                type="button"
                className="task-group-toggle"
                aria-expanded={showTasks}
                onClick={() => setShowTasks((prev) => !prev)}
            >
                <span className="task-group-caret" aria-hidden />
                <span className="task-group-name">{name}</span>
                <span className="task-group-count">{filtered.length}</span>
            </button>
            {showTasks && (
                <div className="task-group-list">
                    {filtered.map((t) => (
                        <TaskRow
                            key={t.id}
                            task={t}
                            expanded={expandedId === t.id}
                            onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                            onStatusChange={(status) =>
                                updateTask(t.id, { status }).catch((err) => reportError("Couldn't update task", err))
                            }
                            onSave={(data) =>
                                updateTask(t.id, data).catch((err) => reportError("Couldn't save task", err))
                            }
                            onDelete={() => {
                                deleteTask(t.id).catch((err) => reportError("Couldn't delete task", err));
                                setExpandedId(null);
                            }}
                        />
                    ))}
                    {filtered.length === 0 && <div className="task-group-empty">No tasks</div>}
                </div>
            )}
        </div>
    );
}

function TaskView(): React.JSX.Element {
    const { addTask } = useTasks();
    const reportError = useReportError();
    const { projects } = useProjects();
    const [showForm, setShowForm] = useState(false);
    const now = useNow();
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const hiddenProjectIds = new Set(projects.filter((p) => !p.show_tasks_in_main_view).map((p) => p.id));
    const visible = (t: Task) => t.project_id === null || !hiddenProjectIds.has(t.project_id);

    // Calendar days from today to the due date (0 = due today, or no due date).
    const getDaysDiff = (task: Task) => (task.due_at === null ? 0 : calendarDaysBetween(now, task.due_at));

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
                    <TaskForm
                        submitLabel="Add"
                        onSubmit={(v) => {
                            addTask(v.title, v.description, v.dueAt).catch((err) =>
                                reportError("Couldn't add task", err),
                            );
                            setShowForm(false);
                        }}
                        onCancel={() => setShowForm(false)}
                    />
                )}
                <div className="task-list themed-scroll">
                    <TaskGroup
                        name="Overdue"
                        filterFunc={(t) =>
                            visible(t) && t.due_at !== null && getDaysDiff(t) < 0 && t.status !== "complete"
                        }
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                    />
                    <TaskGroup
                        name="Today"
                        filterFunc={(t) => visible(t) && t.due_at !== null && getDaysDiff(t) === 0}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                    />
                    <TaskGroup
                        name="This Week"
                        filterFunc={(t) => {
                            if (!visible(t) || t.due_at === null) return false;
                            const diff = getDaysDiff(t);
                            return diff >= 1 && diff <= 7;
                        }}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                        startClosed
                    />
                    <TaskGroup
                        name="Future"
                        filterFunc={(t) => visible(t) && getDaysDiff(t) > 7}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                        startClosed
                    />
                    <TaskGroup
                        name="No Due Date"
                        filterFunc={(t) => visible(t) && t.due_at === null && t.status != "complete"}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                    />
                </div>
            </div>
        </div>
    );
}

export default TaskView;
