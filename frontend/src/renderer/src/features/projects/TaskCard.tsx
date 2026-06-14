import { useEffect, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { Task } from "@renderer/types";
import "./taskCard.css";
import ConfirmDelete from "@renderer/components/ConfirmDelete";
import { useTasks } from "../tasks/useTasks";

type TaskCardProps = {
    task: Task;
    dragging?: boolean;
    onDragStart?: () => void;
    onDragEnd?: () => void;
    onEdit?: () => void;
};

function TaskCard({ task, dragging = false, onDragStart, onDragEnd, onEdit }: TaskCardProps): React.JSX.Element {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const {deleteTask} = useTasks();

    const [showConfirmDelete, setShowConfirmDelete] = useState(false);

    useEffect(() => {
        if (!menuOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [menuOpen]);

    return (
        <div
            className={`task-card${dragging ? " dragging" : ""}`}
            draggable
            onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", task.id);
                onDragStart?.();
            }}
            onDragEnd={() => onDragEnd?.()}
        >
            <div className="task-card-header">
                <span className="task-card-title">{task.title}</span>
                <div className="task-card-menu-container" ref={menuRef}>
                    <button
                        type="button"
                        className={`task-card-menu-btn${menuOpen ? " open" : ""}`}
                        aria-label="Task actions"
                        onClick={() => setMenuOpen(prev => !prev)}
                    >
                        <Ellipsis size={15} />
                    </button>
                    {menuOpen && (
                        <div className="task-card-menu">
                            <button
                                type="button"
                                onClick={() => { setMenuOpen(false); onEdit?.(); }}
                            >
                                Edit
                            </button>
                            <button
                                type="button"
                                className="task-card-menu-danger"
                                onClick={() => { setMenuOpen(false); setShowConfirmDelete(true); }}
                            >
                                Delete
                            </button>
                        </div>
                    )}
                </div>
            </div>
            {task.description && <p className="task-card-desc">{task.description}</p>}
            {showConfirmDelete && <ConfirmDelete
                onClose={() => {setShowConfirmDelete(false)}}
                onDelete={() => {deleteTask(task.id); setShowConfirmDelete(false)}}
                itemName="task"
            />}
        </div>
    );
}

export default TaskCard;
