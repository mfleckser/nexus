import "./taskView.css";
import { useTasks } from "@renderer/features/tasks/useTasks";
import { useProjects } from "@renderer/features/projects/useProjects";
import { useTaskFeatureName } from "@renderer/features/projects/useTaskFeatures";
import { useEvents } from "@renderer/features/calendar/useEvents";
import BlockTimePopover from "@renderer/features/calendar/BlockTimePopover";
import { POPOVER_GAP } from "@renderer/features/calendar/constants";
import { PopoverAnchor } from "@renderer/hooks/usePopoverPosition";
import { useState } from "react";
import { groupTasks, TASK_GROUPS } from "@nexus/shared";
import { Link } from "react-router-dom";
import { Task, TaskStatus } from "@renderer/types";
import useNow from "@renderer/hooks/useNow";
import TaskForm from "@renderer/components/TaskForm";
import { formatDueDisplay, toDatetimeLocal } from "@renderer/lib/time";
import { timeBlockSummary } from "@renderer/lib/timeBlocks";
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
    const blocked = task.status === "blocked";
    const featureName = useTaskFeatureName(task);

    return (
        <div className={`task-row${complete ? " done" : ""}${blocked ? " blocked" : ""}${expanded ? " expanded" : ""}`}>
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
                <span className="task-label">
                    {task.title}
                    {featureName && <span className="task-feature">{featureName}</span>}
                </span>
                {blocked && <span className="task-blocked-badge">Blocked</span>}
            </div>
            {/* Mounted only while expanded, so edit/confirm state resets on collapse. */}
            {expanded && (
                <TaskRowContents
                    task={task}
                    featureName={featureName}
                    onStatusChange={onStatusChange}
                    onSave={onSave}
                    onDelete={onDelete}
                />
            )}
        </div>
    );
}

function TaskRowContents({
    task,
    onStatusChange,
    onSave,
    onDelete,
    featureName,
}: Pick<TaskRowProps, "task" | "onStatusChange" | "onSave" | "onDelete"> & { featureName: string | null }) {
    const { projects } = useProjects();
    const { events } = useEvents();
    const project = task.project_id ? projects.find((p) => p.id === task.project_id) : undefined;
    const [editing, setEditing] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    // Block-time popover anchor; null = closed.
    const [blockAnchor, setBlockAnchor] = useState<PopoverAnchor | null>(null);
    const timeBlock = timeBlockSummary(task, events);
    const canBlockTime = !timeBlock && task.status !== "complete" && task.status !== "cancelled";

    // Beside the task panel: right of the row if there's room, else left of it.
    const openBlockTime = (e: React.MouseEvent<HTMLButtonElement>) => {
        const row = e.currentTarget.closest(".task-row") ?? e.currentTarget;
        const rect = row.getBoundingClientRect();
        const top = e.currentTarget.getBoundingClientRect().top;
        setBlockAnchor({ x: rect.right + POPOVER_GAP, y: top, flipX: rect.left - POPOVER_GAP });
    };

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
                    {project && (
                        <div className="task-detail-field">
                            <span className="task-detail-label">Project</span>
                            <p className="task-detail-value">
                                <Link
                                    className="task-project-link"
                                    to={`/projects/${project.id}`}
                                    title="Open project board"
                                >
                                    {project.title}
                                </Link>
                                {featureName && <span className="task-detail-feature">{featureName}</span>}
                            </p>
                        </div>
                    )}
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
                    {(timeBlock || canBlockTime) && (
                        <div className="task-detail-field">
                            <span className="task-detail-label">Time block</span>
                            {timeBlock ? (
                                <p className="task-detail-value">{timeBlock}</p>
                            ) : (
                                <button
                                    type="button"
                                    className="task-block-time"
                                    aria-expanded={blockAnchor !== null}
                                    onClick={openBlockTime}
                                >
                                    + Block time
                                </button>
                            )}
                        </div>
                    )}
                    <div className="task-row-actions">
                        <button
                            type="button"
                            className={`task-form-btn task-form-btn-danger${confirmDelete ? " armed" : ""}`}
                            onClick={handleDeleteClick}
                            onBlur={() => setConfirmDelete(false)}
                        >
                            {confirmDelete ? "Confirm delete?" : "Delete"}
                        </button>
                        {task.status !== "complete" && task.status !== "cancelled" && (
                            <button
                                type="button"
                                className="task-form-btn task-form-btn-secondary"
                                onClick={() => onStatusChange(task.status === "blocked" ? "todo" : "blocked")}
                            >
                                {task.status === "blocked" ? "Unblock" : "Mark blocked"}
                            </button>
                        )}
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
            {blockAnchor && <BlockTimePopover task={task} anchor={blockAnchor} onClose={() => setBlockAnchor(null)} />}
        </div>
    );
}

type TaskGroupProps = {
    name: string;
    // Already filtered and sorted.
    tasks: Task[];
    expandedId: string | null;
    setExpandedId: (id: string | null) => void;
    startClosed?: boolean;
};

function TaskGroup({ name, tasks, expandedId, setExpandedId, startClosed = false }: TaskGroupProps): React.JSX.Element {
    const { updateTask, deleteTask } = useTasks();
    const reportError = useReportError();
    const [showTasks, setShowTasks] = useState(!startClosed);

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
                <span className="task-group-count">{tasks.length}</span>
            </button>
            {showTasks && (
                <div className="task-group-list">
                    {tasks.map((t) => (
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
                    {tasks.length === 0 && <div className="task-group-empty">No tasks</div>}
                </div>
            )}
        </div>
    );
}

function TaskView(): React.JSX.Element {
    const { tasks, addTask } = useTasks();
    const reportError = useReportError();
    const { projects } = useProjects();
    const [showForm, setShowForm] = useState(false);
    const now = useNow();
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const hiddenProjectIds = new Set(projects.filter((p) => !p.show_tasks_in_main_view).map((p) => p.id));
    const groups = groupTasks(tasks, now, hiddenProjectIds);

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
                    {TASK_GROUPS.map(({ key, name }) => (
                        <TaskGroup
                            key={key}
                            name={name}
                            tasks={groups[key]}
                            expandedId={expandedId}
                            setExpandedId={setExpandedId}
                            startClosed={key === "thisWeek" || key === "future"}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

export default TaskView;
