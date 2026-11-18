import "./taskPin.css";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Task } from "@renderer/types";
import { useTasks } from "@renderer/features/tasks/useTasks";
import useTaskItem from "@renderer/features/calendar/useTaskItem";
import { formatTime, MINUTES_PER_DAY, shiftDays } from "@renderer/lib/time";
import useReportError from "@renderer/hooks/useReportError";
import { DayMarker } from "@renderer/lib/eventLayout";
import {
    DRAG_THRESHOLD,
    PX_PER_MIN,
    TASK_PIN_HEIGHT,
    TASK_PIN_INSET,
    TASK_SNAP_MINUTES,
} from "@renderer/features/calendar/constants";

type TaskPinProps = {
    // The task (due date non-null for anything on the calendar), its due day
    // and its place within that day.
    pin: DayMarker<Task & { due_at: Date }>;
    // Day columns in the grid: 7 in week view, 1 in day view.
    dayCount: number;
};

function TaskPin({ pin, dayCount }: TaskPinProps): React.JSX.Element {
    const { item: task, dayIndex: dayIdx } = pin;
    const { updateTask } = useTasks();
    const reportError = useReportError();
    const pinRef = useRef<HTMLDivElement>(null);
    const parentRectRef = useRef<DOMRect | null>(null);
    const grabOffsetRef = useRef({ x: 0, y: 0 });
    const pressPosRef = useRef({ x: 0, y: 0 });
    // Set when a real drag ends, so the click that follows the mouseup
    // doesn't also open the popover.
    const suppressClickRef = useRef(false);
    // Kept at the width it had when grabbed, so it can't widen past the grid.
    const [dragPos, setDragPos] = useState<{ left: number; top: number; width: number } | null>(null);
    const { done, toggleComplete, featureName, popoverOpen, togglePopover, popover } = useTaskItem(task, pinRef);

    const due = task.due_at;
    const cancelled = task.status === "cancelled";
    const blocked = task.status === "blocked";

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
            width: pinRect.width,
        });
    }

    const dragging = dragPos !== null;

    const onDragMove = useEffectEvent((e: MouseEvent) => {
        const parentRect = parentRectRef.current;
        if (!parentRect) return;
        setDragPos(
            (prev) =>
                prev && {
                    ...prev,
                    left: e.clientX - parentRect.left - grabOffsetRef.current.x,
                    top: e.clientY - parentRect.top - grabOffsetRef.current.y,
                },
        );
    });

    const onDragEnd = useEffectEvent((e: MouseEvent) => {
        setDragPos(null);
        const parentRect = parentRectRef.current;
        const moved = Math.hypot(e.clientX - pressPosRef.current.x, e.clientY - pressPosRef.current.y) > DRAG_THRESHOLD;
        if (!parentRect || !moved) return;
        suppressClickRef.current = true;

        const newDayIdx = Math.min(
            dayCount - 1,
            Math.max(0, Math.floor((dayCount * (e.clientX - parentRect.left)) / parentRect.width)),
        );
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

    // Inset within its slot of the day column.
    const style: React.CSSProperties = dragPos
        ? { ...dragPos, height: TASK_PIN_HEIGHT }
        : {
              left: `calc(${((dayIdx + pin.left) * 100) / dayCount}% + ${TASK_PIN_INSET}px)`,
              top: pin.startMin * PX_PER_MIN,
              width: `calc(${(pin.width * 100) / dayCount}% - ${2 * TASK_PIN_INSET}px)`,
              height: TASK_PIN_HEIGHT,
          };

    return (
        <>
            <div
                ref={pinRef}
                className={`task-pin${done ? " done" : ""}${cancelled ? " cancelled" : ""}${blocked ? " blocked" : ""}${dragging ? " dragging" : ""}`}
                style={style}
                title={featureName ? `${task.title} · ${featureName}` : task.title}
                role="button"
                tabIndex={0}
                aria-expanded={popoverOpen}
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
                <div className="task-pin-body">
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
                    <span className="task-pin-title">
                        {task.title}
                        {featureName && <span className="task-pin-feature">{featureName}</span>}
                    </span>
                    <span className="task-pin-time">{formatTime(due)}</span>
                </div>
            </div>
            {popover}
        </>
    );
}

export default TaskPin;
