import { useState } from "react";
import { Task } from "@renderer/types";
import { useTasks } from "@renderer/features/tasks/useTasks";
import TaskPopover from "@renderer/features/calendar/TaskPopover";
import BlockTimePopover from "@renderer/features/calendar/BlockTimePopover";
import { useTaskFeatureName } from "@renderer/features/projects/useTaskFeatures";
import { POPOVER_GAP } from "@renderer/features/calendar/constants";
import useReportError from "@renderer/hooks/useReportError";
import { PopoverAnchor } from "@renderer/hooks/usePopoverPosition";

export type TaskItem = {
    done: boolean;
    toggleComplete: () => void;
    // The task's feature, when it has one.
    featureName: string | null;
    popoverOpen: boolean;
    // Opens the task popover beside `itemRef`'s element, or closes it.
    togglePopover: () => void;
    // The task popover or block-time popover while open; render it next to the item.
    popover: React.ReactNode;
};

// Completion toggle and task popover shared by the calendar's task items
// (week/day view pins, month view lines). `itemRef` is the item's element.
export default function useTaskItem(task: Task, itemRef: React.RefObject<HTMLElement | null>): TaskItem {
    const { updateTask } = useTasks();
    const reportError = useReportError();
    const featureName = useTaskFeatureName(task);
    // Popover anchor, captured from the item's rect when it opens; null = closed.
    const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
    // Block-time popover, opened from the task popover in its place; null = closed.
    const [blockAnchor, setBlockAnchor] = useState<PopoverAnchor | null>(null);
    const done = task.status === "complete";

    function toggleComplete(): void {
        updateTask(task.id, { status: done ? "todo" : "complete" }).catch((err) =>
            reportError("Couldn't update task", err),
        );
    }

    function togglePopover(): void {
        if (anchor) {
            setAnchor(null);
            return;
        }
        const rect = itemRef.current?.getBoundingClientRect();
        if (rect) setAnchor({ x: rect.right + POPOVER_GAP, y: rect.top, flipX: rect.left - POPOVER_GAP });
    }

    const popover = (
        <>
            {anchor && (
                <TaskPopover
                    task={task}
                    featureName={featureName}
                    anchor={anchor}
                    ignoreRef={itemRef}
                    onToggleComplete={toggleComplete}
                    onBlockTime={() => {
                        setBlockAnchor(anchor);
                        setAnchor(null);
                    }}
                    onClose={() => setAnchor(null)}
                />
            )}
            {blockAnchor && <BlockTimePopover task={task} anchor={blockAnchor} onClose={() => setBlockAnchor(null)} />}
        </>
    );

    return { done, toggleComplete, featureName, popoverOpen: anchor !== null, togglePopover, popover };
}
