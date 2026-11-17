import "@renderer/components/taskForm.css";
import "./taskDetailModal.css";
import Modal from "@renderer/components/Modal";
import { Task, TaskStatus } from "@renderer/types";
import { formatDateDisplay, formatDueDisplay } from "@renderer/lib/time";

// Kanban column names, plus cancelled (which has no column).
const STATUS_LABELS: Record<TaskStatus, string> = {
    todo: "To Do",
    active: "Active",
    blocked: "Blocked",
    complete: "Complete",
    cancelled: "Cancelled",
};

type TaskDetailModalProps = {
    task: Task;
    // null when the task's feature isn't loaded; the meta line then leaves it out.
    featureName: string | null;
    onEdit: () => void;
    onClose: () => void;
};

// Read-only expanded view of a kanban task, mainly for reading a long description.
function TaskDetailModal({ task, featureName, onEdit, onClose }: TaskDetailModalProps): React.JSX.Element {
    return (
        <Modal onClose={onClose} title={task.title} className="task-detail-modal">
            <div className="td-meta">
                {featureName !== null && (
                    <>
                        <span>{featureName}</span>
                        <span className="td-sep">·</span>
                    </>
                )}
                <span className={`td-status td-status-${task.status}`}>
                    {STATUS_LABELS[task.status] ?? task.status}
                </span>
                <span className="td-sep">·</span>
                <span>{task.due_at ? `Due ${formatDueDisplay(task.due_at)}` : "No due date"}</span>
            </div>
            <div className={`td-description themed-scroll${task.description ? "" : " muted"}`}>
                {task.description || "No description"}
            </div>
            <div className="td-footer">
                <div className="td-dates">
                    <span>Created {formatDateDisplay(task.created_at)}</span>
                    {task.completed_at && <span>Completed {formatDateDisplay(task.completed_at)}</span>}
                </div>
                <button type="button" className="task-form-btn task-form-btn-secondary" onClick={onEdit}>
                    Edit
                </button>
            </div>
        </Modal>
    );
}

export default TaskDetailModal;
