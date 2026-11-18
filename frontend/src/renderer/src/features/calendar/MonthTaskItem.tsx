import { useRef, useState } from "react";
import { Task } from "@renderer/types";
import { useTasks } from "@renderer/features/tasks/useTasks";
import TaskPopover from "@renderer/features/calendar/TaskPopover";
import BlockTimePopover from "@renderer/features/calendar/BlockTimePopover";
import { useTaskFeatureName } from "@renderer/features/projects/useTaskFeatures";
import { POPOVER_GAP } from "@renderer/features/calendar/constants";
import { formatTime } from "@renderer/lib/time";
import useReportError from "@renderer/hooks/useReportError";
import { PopoverAnchor } from "@renderer/hooks/usePopoverPosition";

type MonthTaskItemProps = {
    task: Task & { due_at: Date };
    // Placement in the week row, set by MonthView.
    style: React.CSSProperties;
};

// A due task's line in a month day cell: check, due time, title. Click to
// open the task popover; the check toggles completion.
function MonthTaskItem({ task, style }: MonthTaskItemProps): React.JSX.Element {
    const { updateTask } = useTasks();
    const reportError = useReportError();
    const featureName = useTaskFeatureName(task);
    const itemRef = useRef<HTMLDivElement>(null);
    // Popover anchor, captured from the item's rect when it opens; null = closed.
    const [popoverAnchor, setPopoverAnchor] = useState<PopoverAnchor | null>(null);
    // Block-time popover, opened from the task popover in its place; null = closed.
    const [blockAnchor, setBlockAnchor] = useState<PopoverAnchor | null>(null);
    const done = task.status === "complete";
    const time = formatTime(task.due_at);

    function toggleComplete(): void {
        updateTask(task.id, { status: done ? "todo" : "complete" }).catch((err) =>
            reportError("Couldn't update task", err),
        );
    }

    function togglePopover(): void {
        if (popoverAnchor) {
            setPopoverAnchor(null);
            return;
        }
        const rect = itemRef.current?.getBoundingClientRect();
        if (rect) setPopoverAnchor({ x: rect.right + POPOVER_GAP, y: rect.top, flipX: rect.left - POPOVER_GAP });
    }

    return (
        <>
            <div
                ref={itemRef}
                className={`month-item month-task month-task-${task.status}`}
                role="button"
                tabIndex={0}
                aria-expanded={popoverAnchor !== null}
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
            {popoverAnchor && (
                <TaskPopover
                    task={task}
                    featureName={featureName}
                    anchor={popoverAnchor}
                    ignoreRef={itemRef}
                    onToggleComplete={toggleComplete}
                    onBlockTime={() => {
                        setBlockAnchor(popoverAnchor);
                        setPopoverAnchor(null);
                    }}
                    onClose={() => setPopoverAnchor(null)}
                />
            )}
            {blockAnchor && <BlockTimePopover task={task} anchor={blockAnchor} onClose={() => setBlockAnchor(null)} />}
        </>
    );
}

export default MonthTaskItem;
