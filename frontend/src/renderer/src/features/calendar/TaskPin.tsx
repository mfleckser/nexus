import "./taskPin.css";
import { useEffect, useRef, useState } from "react";
import { Task } from "@renderer/types";
import { useTasks } from "@renderer/features/tasks/useTasks";
import TaskPopover from "@renderer/features/calendar/TaskPopover";
import { formatTime } from "@renderer/lib/time";

const PX_PER_HOUR = 48;
const PX_PER_MIN = PX_PER_HOUR / 60;
const POPOVER_GAP = 8;
// Mouse travel (px) below which a press on the pin is a click, not a drag.
const DRAG_THRESHOLD = 3;
const SNAP_MINUTES = 15;
export const TASK_PIN_HEIGHT = 18;

type TaskPinProps = {
    // Due date is non-null for anything rendered on the calendar.
    task: Task & { due_at: Date },
    // Pixel top within the day grid. Usually the due time, pushed down when
    // an earlier pin on the same day would overlap it.
    top: number
};

function TaskPin({ task, top }: TaskPinProps): React.JSX.Element {
    const { updateTask } = useTasks();
    const pinRef = useRef<HTMLDivElement>(null);
    const parentRectRef = useRef<DOMRect | null>(null);
    const grabOffsetRef = useRef({ x: 0, y: 0 });
    const pressPosRef = useRef({ x: 0, y: 0 });
    // Set when a real drag ends, so the click that follows the mouseup
    // doesn't also open the popover.
    const suppressClickRef = useRef(false);
    const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);
    // Popover anchor, captured from the pin's rect when it opens; null = closed.
    const [popoverAnchor, setPopoverAnchor] = useState<{ x: number; y: number; flipX: number } | null>(null);

    const due = task.due_at;
    const dayIdx = due.getDay();
    const done = task.status === "complete";
    const cancelled = task.status === "cancelled";

    function toggleComplete(): void {
        updateTask(task.id, { status: done ? "todo" : "complete" }).catch(console.error);
    }

    function movedPastThreshold(e: MouseEvent): boolean {
        return Math.hypot(e.clientX - pressPosRef.current.x, e.clientY - pressPosRef.current.y) > DRAG_THRESHOLD;
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

    useEffect(() => {
        if (!dragging) return;
        function onMove(e: MouseEvent): void {
            const parentRect = parentRectRef.current;
            if (!parentRect) return;
            setDragPos({
                left: e.clientX - parentRect.left - grabOffsetRef.current.x,
                top: e.clientY - parentRect.top - grabOffsetRef.current.y,
            });
        }
        function onUp(e: MouseEvent): void {
            setDragPos(null);
            const parentRect = parentRectRef.current;
            if (!parentRect || !movedPastThreshold(e)) return;
            suppressClickRef.current = true;

            const newDayIdx = Math.min(6, Math.max(0, Math.floor(7 * (e.clientX - parentRect.left) / parentRect.width)));
            const rawMins = (e.clientY - parentRect.top - grabOffsetRef.current.y) / PX_PER_MIN;
            const mins = Math.min(
                Math.max(0, SNAP_MINUTES * Math.round(rawMins / SNAP_MINUTES)),
                24 * 60 - SNAP_MINUTES,
            );
            const newDue = new Date(due);
            newDue.setDate(newDue.getDate() + newDayIdx - dayIdx);
            newDue.setHours(0, mins, 0, 0);
            if (newDue.getTime() === due.getTime()) return;
            updateTask(task.id, { due_at: newDue }).catch(console.error);
        }
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dragging]);

    const style: React.CSSProperties = dragPos
        ? { left: dragPos.left, top: dragPos.top, height: TASK_PIN_HEIGHT }
        : { left: `calc(${dayIdx * 100 / 7}% + 3px)`, top, height: TASK_PIN_HEIGHT };

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
                onMouseDown={onMouseDown}
                onClick={() => {
                    if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                    }
                    togglePopover();
                }}
            >
                <button
                    type="button"
                    className="task-pin-check"
                    aria-label={done ? "Mark incomplete" : "Mark complete"}
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); toggleComplete(); }}
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
