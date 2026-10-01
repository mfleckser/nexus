import "./taskPopover.css";
import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Task } from "@renderer/types";
import { useTasks } from "@renderer/features/tasks/useTasks";
import { useProjects } from "@renderer/features/projects/useProjects";
import TaskForm from "@renderer/components/TaskForm";
import ConfirmDelete from "@renderer/components/ConfirmDelete";
import { formatDueDisplay, toDatetimeLocal } from "@renderer/lib/time";

const STATUS_LABELS: Record<string, string> = {
    todo: "To do",
    active: "In progress",
    complete: "Complete",
    cancelled: "Cancelled",
};

type TaskPopoverProps = {
    task: Task,
    // flipX: right edge to place the popover against when it would overflow
    // the window's right side at x (the left edge of the pin).
    anchor: { x: number; y: number; flipX?: number },
    // Presses inside this element don't count as outside clicks (the pin
    // toggles the popover itself).
    ignoreRef?: RefObject<HTMLElement | null>,
    onToggleComplete: () => void,
    onClose: () => void
};

function TaskPopover({ task, anchor, ignoreRef, onToggleComplete, onClose }: TaskPopoverProps): React.JSX.Element {
    const { updateTask, deleteTask } = useTasks();
    const { projects } = useProjects();
    const rootRef = useRef<HTMLDivElement>(null);
    const [editing, setEditing] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [top, setTop] = useState(anchor.y);
    const [left, setLeft] = useState(anchor.x);

    const done = task.status === "complete";
    const project = task.project_id ? projects.find(p => p.id === task.project_id) : undefined;

    // Re-clamp whenever the popover grows/shrinks (edit form, long description).
    useLayoutEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        const margin = 8;
        const clamp = (): void => {
            const maxTop = window.innerHeight - el.offsetHeight - margin;
            setTop(Math.max(margin, Math.min(anchor.y, maxTop)));
            const maxLeft = window.innerWidth - el.offsetWidth - margin;
            const x = anchor.x > maxLeft && anchor.flipX !== undefined ? anchor.flipX - el.offsetWidth : anchor.x;
            setLeft(Math.max(margin, Math.min(x, maxLeft)));
        };
        clamp();
        const observer = new ResizeObserver(clamp);
        observer.observe(el);
        return () => observer.disconnect();
    }, [anchor.x, anchor.y, anchor.flipX]);

    useEffect(() => {
        function onKey(e: KeyboardEvent): void {
            if (e.key === "Escape") onClose();
        }
        function onClick(e: MouseEvent): void {
            const target = e.target as Node;
            if (rootRef.current?.contains(target) || ignoreRef?.current?.contains(target)) return;
            onClose();
        }
        window.addEventListener("keydown", onKey);
        window.addEventListener("mousedown", onClick);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("mousedown", onClick);
        };
    }, [onClose, ignoreRef]);

    return (
        <div
            ref={rootRef}
            className={`task-popover themed-scroll${done ? " done" : ""}`}
            style={{ left, top }}
            role="dialog"
            aria-label={task.title}
        >
            {editing ? (
                <TaskForm
                    submitLabel="Save"
                    initialTitle={task.title}
                    initialDescription={task.description ?? ""}
                    initialDueAt={toDatetimeLocal(task.due_at)}
                    onSubmit={(v) => {
                        updateTask(task.id, { title: v.title, description: v.description, due_at: v.dueAt }).catch(console.error);
                        setEditing(false);
                    }}
                    onCancel={() => setEditing(false)}
                />
            ) : (
                <>
                    <div className="tp-header">
                        <button
                            type="button"
                            className="tp-check"
                            aria-label={done ? "Mark incomplete" : "Mark complete"}
                            onClick={onToggleComplete}
                        />
                        <span className="tp-title">{task.title}</span>
                    </div>
                    <div className="tp-meta">
                        <span>{formatDueDisplay(task.due_at)}</span>
                        <span className={`tp-status tp-status-${task.status}`}>
                            {STATUS_LABELS[task.status] ?? task.status}
                        </span>
                    </div>
                    {project && <div className="tp-project">{project.title}</div>}
                    <p className={`tp-description${task.description ? "" : " muted"}`}>
                        {task.description || "No description"}
                    </p>
                    <div className="tp-actions">
                        <button
                            type="button"
                            className="task-form-btn task-form-btn-danger"
                            onClick={() => setConfirmDelete(true)}
                        >
                            Delete
                        </button>
                        <button
                            type="button"
                            className="task-form-btn task-form-btn-secondary"
                            onClick={() => setEditing(true)}
                        >
                            Edit
                        </button>
                    </div>
                </>
            )}
            {confirmDelete && <ConfirmDelete
                onClose={() => setConfirmDelete(false)}
                onDelete={() => {
                    setConfirmDelete(false);
                    onClose();
                    deleteTask(task.id).catch(console.error);
                }}
                itemName="task"
            />}
        </div>
    );
}

export default TaskPopover;
