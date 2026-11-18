import { useRef } from "react";
import { Task } from "@renderer/types";
import useTaskItem from "@renderer/features/calendar/useTaskItem";
import { formatTime } from "@renderer/lib/time";

type MonthTaskItemProps = {
    task: Task & { due_at: Date };
    // Placement in the week row, set by MonthView.
    style: React.CSSProperties;
};

// A due task's line in a month day cell: check, due time, title. Click to
// open the task popover; the check toggles completion.
function MonthTaskItem({ task, style }: MonthTaskItemProps): React.JSX.Element {
    const itemRef = useRef<HTMLDivElement>(null);
    const { done, toggleComplete, popoverOpen, togglePopover, popover } = useTaskItem(task, itemRef);
    const time = formatTime(task.due_at);

    return (
        <>
            <div
                ref={itemRef}
                className={`month-item month-task month-task-${task.status}`}
                role="button"
                tabIndex={0}
                aria-expanded={popoverOpen}
                title={`${task.title} · ${time}`}
                style={style}
                onClick={togglePopover}
                onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    togglePopover();
                }}
            >
                <button
                    type="button"
                    className="month-task-check"
                    aria-label={done ? "Mark incomplete" : "Mark complete"}
                    aria-pressed={done}
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleComplete();
                    }}
                />
                <span className="month-item-time">{time}</span>
                <span className="month-item-title">{task.title}</span>
            </div>
            {popover}
        </>
    );
}

export default MonthTaskItem;
