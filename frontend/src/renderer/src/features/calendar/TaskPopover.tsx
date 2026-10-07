import "./taskPopover.css";
import { RefObject, useRef, useState } from "react";
import { Task, TaskStatus } from "@renderer/types";
import { useTasks } from "@renderer/features/tasks/useTasks";
import { useProjects } from "@renderer/features/projects/useProjects";
import TaskForm from "@renderer/components/TaskForm";
import ConfirmDelete from "@renderer/components/ConfirmDelete";
import { formatDueDisplay, toDatetimeLocal } from "@renderer/lib/time";
import useDismiss from "@renderer/hooks/useDismiss";
import usePopoverPosition, { PopoverAnchor } from "@renderer/hooks/usePopoverPosition";
import useReportError from "@renderer/hooks/useReportError";

const STATUS_LABELS: Record<TaskStatus, string> = {
    todo: "To do",
    active: "In progress",
    complete: "Complete",
    cancelled: "Cancelled",
};

type TaskPopoverProps = {
    task: Task;
    anchor: PopoverAnchor;
    // Presses inside this element don't count as outside clicks (the pin
    // toggles the popover itself).
    ignoreRef?: RefObject<HTMLElement | null>;
    onToggleComplete: () => void;
    onClose: () => void;
};

function TaskPopover({ task, anchor, ignoreRef, onToggleComplete, onClose }: TaskPopoverProps): React.JSX.Element {
    const { updateTask, deleteTask } = useTasks();
    const { projects } = useProjects();
    const rootRef = useRef<HTMLDivElement>(null);
    const [editing, setEditing] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const { left, top } = usePopoverPosition(rootRef, anchor);
    const reportError = useReportError();

    const done = task.status === "complete";
    const project = task.project_id ? projects.find((p) => p.id === task.project_id) : undefined;

    useDismiss(rootRef, onClose, { ignoreRef });

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
                        updateTask(task.id, { title: v.title, description: v.description, due_at: v.dueAt }).catch(
                            (err) => reportError("Couldn't save task", err),
                        );
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
            {confirmDelete && (
                <ConfirmDelete
                    onClose={() => setConfirmDelete(false)}
                    onDelete={() => {
                        setConfirmDelete(false);
                        onClose();
                        deleteTask(task.id).catch((err) => reportError("Couldn't delete task", err));
                    }}
                    itemName="task"
                />
            )}
        </div>
    );
}

export default TaskPopover;
