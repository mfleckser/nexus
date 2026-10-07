import "./taskPin.css";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Task } from "@renderer/types";
import { useTasks } from "@renderer/features/tasks/useTasks";
import TaskPopover from "@renderer/features/calendar/TaskPopover";
import { formatTime, MINUTES_PER_DAY, shiftDays } from "@renderer/lib/time";
import useReportError from "@renderer/hooks/useReportError";
import { PopoverAnchor } from "@renderer/hooks/usePopoverPosition";
import {
    DRAG_THRESHOLD,
    POPOVER_GAP,
    PX_PER_MIN,
    TASK_PIN_HEIGHT,
    TASK_SNAP_MINUTES,
} from "@renderer/features/calendar/constants";

type TaskPinProps = {
    // Due date is non-null for anything rendered on the calendar.
    task: Task & { due_at: Date };
    // Pixel top within the day grid. Usually the due time, pushed down when
    // an earlier pin on the same day would overlap it.
    top: number;
};

function TaskPin({ task, top }: TaskPinProps): React.JSX.Element {
    const { updateTask } = useTasks();
    const reportError = useReportError();
    const pinRef = useRef<HTMLDivElement>(null);
    const parentRectRef = useRef<DOMRect | null>(null);
    const grabOffsetRef = useRef({ x: 0, y: 0 });
    const pressPosRef = useRef({ x: 0, y: 0 });
    // Set when a real drag ends, so the click that follows the mouseup
    // doesn't also open the popover.
    const suppressClickRef = useRef(false);
    const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);
    // Popover anchor, captured from the pin's rect when it opens; null = closed.
    const [popoverAnchor, setPopoverAnchor] = useState<PopoverAnchor | null>(null);

    const due = task.due_at;
    const dayIdx = due.getDay();
    const done = task.status === "complete";
    const cancelled = task.status === "cancelled";

    function toggleComplete(): void {
        updateTask(task.id, { status: done ? "todo" : "complete" }).catch((err) =>
            reportError("Couldn't update task", err),
        );
    }

    function onMouseDown(e: React.MouseEvent): void {
        if (e.button !== 0) return;
        const pin = pinRef.current;
        if (!pin) return;
        suppressClickRef.current = false;
        pressPosRef.current = { x: e.clientX, y: e.clientY };
        const pinRect = pin.getBoundingClientRect();
        const parent = pin.offsetParent as HTMLElement | null;
        const parentRect = parent ? parent.getBoundingClientRect() : null;
        parentRectRef.current = parentRect;
        grabOffsetRef.current = {
            x: e.clientX - pinRect.left,
            y: e.clientY - pinRect.top,
        };
        setDragPos({
            left: pinRect.left - (parentRect?.left ?? 0),
            top: pinRect.top - (parentRect?.top ?? 0),
        });
    }

    const dragging = dragPos !== null;

    const onDragMove = useEffectEvent((e: MouseEvent) => {
        const parentRect = parentRectRef.current;
        if (!parentRect) return;
        setDragPos({
            left: e.clientX - parentRect.left - grabOffsetRef.current.x,
            top: e.clientY - parentRect.top - grabOffsetRef.current.y,
        });
    });

    const onDragEnd = useEffectEvent((e: MouseEvent) => {
        setDragPos(null);
        const parentRect = parentRectRef.current;
        const moved = Math.hypot(e.clientX - pressPosRef.current.x, e.clientY - pressPosRef.current.y) > DRAG_THRESHOLD;
        if (!parentRect || !moved) return;
        suppressClickRef.current = true;

        const newDayIdx = Math.min(6, Math.max(0, Math.floor((7 * (e.clientX - parentRect.left)) / parentRect.width)));
        const rawMins = (e.clientY - parentRect.top - grabOffsetRef.current.y) / PX_PER_MIN;
        const mins = Math.min(
            Math.max(0, TASK_SNAP_MINUTES * Math.round(rawMins / TASK_SNAP_MINUTES)),
            MINUTES_PER_DAY - TASK_SNAP_MINUTES,
        );
        const newDue = shiftDays(due, newDayIdx - dayIdx);
        newDue.setHours(0, mins, 0, 0);
        if (newDue.getTime() === due.getTime()) return;
        updateTask(task.id, { due_at: newDue }).catch((err) => reportError("Couldn't move task", err));
    });

    useEffect(() => {
        if (!dragging) return;
        window.addEventListener("mousemove", onDragMove);
        window.addEventListener("mouseup", onDragEnd);
        return () => {
            window.removeEventListener("mousemove", onDragMove);
            window.removeEventListener("mouseup", onDragEnd);
        };
    }, [dragging]);

    const style: React.CSSProperties = dragPos
        ? { left: dragPos.left, top: dragPos.top, height: TASK_PIN_HEIGHT }
        : { left: `calc(${(dayIdx * 100) / 7}% + 3px)`, top, height: TASK_PIN_HEIGHT };

    function togglePopover(): void {
        if (popoverAnchor) {
            setPopoverAnchor(null);
            return;
        }
        const rect = pinRef.current?.getBoundingClientRect();
        if (!rect) return;
        setPopoverAnchor({ x: rect.right + POPOVER_GAP, y: rect.top, flipX: rect.left - POPOVER_GAP });
    }

    return (
        <>
            <div
                ref={pinRef}
                className={`task-pin${done ? " done" : ""}${cancelled ? " cancelled" : ""}${dragging ? " dragging" : ""}`}
                style={style}
                title={task.title}
                role="button"
                tabIndex={0}
                aria-expanded={popoverAnchor !== null}
                onMouseDown={onMouseDown}
                onClick={() => {
                    if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                    }
                    togglePopover();
                }}
                onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    togglePopover();
                }}
            >
                <button
                    type="button"
                    className="task-pin-check"
                    aria-label={done ? "Mark incomplete" : "Mark complete"}
                    aria-pressed={done}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleComplete();
                    }}
                />
                <span className="task-pin-title">{task.title}</span>
                <span className="task-pin-time">{formatTime(due)}</span>
            </div>
            {popoverAnchor && (
                <TaskPopover
                    task={task}
                    anchor={popoverAnchor}
                    ignoreRef={pinRef}
                    onToggleComplete={toggleComplete}
                    onClose={() => setPopoverAnchor(null)}
                />
            )}
        </>
    );
}

export default TaskPin;
