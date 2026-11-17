import { useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { Task } from "@renderer/types";
import "./taskCard.css";
import ConfirmDelete from "@renderer/components/ConfirmDelete";
import { useTasks } from "@renderer/features/tasks/useTasks";
import useDismiss from "@renderer/hooks/useDismiss";
import useReportError from "@renderer/hooks/useReportError";

type TaskCardProps = {
    task: Task;
    dragging?: boolean;
    onDragStart?: () => void;
    onDragEnd?: () => void;
    onEdit?: () => void;
    // A plain click on the card (not a drag or the ⋯ menu).
    onOpen?: () => void;
};

function TaskCard({
    task,
    dragging = false,
    onDragStart,
    onDragEnd,
    onEdit,
    onOpen,
}: TaskCardProps): React.JSX.Element {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    // Whether a card's ⋯ menu (this one or another) was open when the current click
    // began: that click only dismisses it (useDismiss closes it on mousedown).
    const menuOpenAtPressRef = useRef(false);

    const { deleteTask } = useTasks();
    const reportError = useReportError();

    const [showConfirmDelete, setShowConfirmDelete] = useState(false);

    useDismiss(menuRef, () => setMenuOpen(false), { enabled: menuOpen });

    return (
        <div
            className={`task-card${task.status === "blocked" ? " blocked" : ""}${dragging ? " dragging" : ""}`}
            draggable
            onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", task.id);
                onDragStart?.();
            }}
            onDragEnd={() => onDragEnd?.()}
            onMouseDown={() => {
                menuOpenAtPressRef.current = document.querySelector(".task-card-menu") !== null;
            }}
            onClick={(e) => {
                const target = e.target as Element;
                // Clicks inside portaled children (the delete confirm) bubble here
                // through the React tree; only clicks on the card itself count.
                if (!e.currentTarget.contains(target)) return;
                if (menuOpenAtPressRef.current || target.closest(".task-card-menu-container")) return;
                onOpen?.();
            }}
        >
            <div className="task-card-header">
                <span className="task-card-title">{task.title}</span>
                <div className="task-card-menu-container" ref={menuRef}>
                    <button
                        type="button"
                        className={`task-card-menu-btn${menuOpen ? " open" : ""}`}
                        aria-label="Task actions"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen((prev) => !prev)}
                    >
                        <Ellipsis size={15} />
                    </button>
                    {menuOpen && (
                        <div className="task-card-menu">
                            <button
                                type="button"
                                onClick={() => {
                                    setMenuOpen(false);
                                    onEdit?.();
                                }}
                            >
                                Edit
                            </button>
                            <button
                                type="button"
                                className="task-card-menu-danger"
                                onClick={() => {
                                    setMenuOpen(false);
                                    setShowConfirmDelete(true);
                                }}
                            >
                                Delete
                            </button>
                        </div>
                    )}
                </div>
            </div>
            {task.description && <p className="task-card-desc">{task.description}</p>}
            {showConfirmDelete && (
                <ConfirmDelete
                    onClose={() => {
                        setShowConfirmDelete(false);
                    }}
                    onDelete={() => {
                        deleteTask(task.id).catch((err) => reportError("Couldn't delete task", err));
                        setShowConfirmDelete(false);
                    }}
                    itemName="task"
                />
            )}
        </div>
    );
}

export default TaskCard;
