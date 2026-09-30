import { useEvents } from "@renderer/features/calendar/useEvents";
import { useEffect, useRef, useState } from "react";
import { Repeat } from "lucide-react";
import { Event, NewEventDraft, RecurrenceScope } from "@renderer/types";
import NewEventPopover from "@renderer/features/calendar/NewEventPopover";
import ConfirmDelete from "@renderer/components/ConfirmDelete";
import RecurrenceScopePrompt from "@renderer/components/RecurrenceScopePrompt";
import categoryData from "./categories.json"
import { browserTimeZone } from "@renderer/lib/time";
import { describeRrule, sameRrule } from "@renderer/lib/rrule";

const PX_PER_HOUR = 48;
const PX_PER_MIN = PX_PER_HOUR / 60;
const POPOVER_GAP = 8;
// Mouse travel (px) below which a press on the chip is a click, not a drag/resize.
const DRAG_THRESHOLD = 3;
const MIN_DURATION = 30;

const fmtTime = (d: Date): string => {
    const h = d.getHours();
    const m = d.getMinutes();
    const hh = (h % 12) || 12;
    const mm = m.toString().padStart(2, "0");
    return `${hh}:${mm} ${h >= 12 ? "PM" : "AM"}`;
};

// A mutation of a recurring occurrence waiting on the scope prompt.
type PendingScope =
    | { action: "edit", data: Record<string, unknown>, scopes?: RecurrenceScope[] }
    | { action: "delete" };

type EventChipProps = {
    event: Event,
    cols: number,
    colIdx: number
};

function EventChip({ event, cols, colIdx } : EventChipProps): React.JSX.Element {
    const chipRef = useRef<HTMLDivElement>(null);
    const parentRectRef = useRef<DOMRect | null>(null);
    const grabOffsetRef = useRef({ x: 0, y: 0 });
    const pressPosRef = useRef({ x: 0, y: 0 });
    // Set when a real drag/resize ends, so the click that follows the mouseup
    // doesn't also open the edit popover.
    const suppressClickRef = useRef(false);
    const [dragging, setDragging] = useState(false);
    const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);
    const [adjustingDuration, setAdjustingDuration] = useState(false);
    // Live height while resizing; null otherwise.
    const [resizeDuration, setResizeDuration] = useState<number | null>(null);
    // Dropped/resized times of a recurring occurrence, shown while the scope
    // prompt is open. Nothing is committed until a scope is chosen; Cancel
    // just clears this and the chip falls back to `event`.
    const [preview, setPreview] = useState<{ start: Date, end: Date } | null>(null);
    const [pendingScope, setPendingScope] = useState<PendingScope | null>(null);
    const [showPopover, setShowPopover] = useState(false);
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);

    const {updateEvent, deleteEvent} = useEvents();

    const shownStart = preview?.start ?? event.start_at;
    const shownEnd = preview?.end ?? event.end_at;
    const duration = resizeDuration ?? (shownEnd.getTime() - shownStart.getTime()) / (1000 * 60);
    const dayIdx = shownStart.getDay();
    const baseTop = (60 * shownStart.getHours() + shownStart.getMinutes()) * PX_PER_MIN;
    const isOccurrence = event.recurring_event_id !== null;

    // Plain events commit straight away; occurrences wait for a scope.
    function requestUpdate(data: Record<string, unknown>, scopes?: RecurrenceScope[]): void {
        if (!isOccurrence) {
            updateEvent(event, data).catch(console.error);
            return;
        }
        setPendingScope({ action: "edit", data, scopes });
    }

    // Drag/resize result. Only changed fields are sent; a drop back onto the
    // same slot sends nothing.
    function commitTimes(start: Date, end: Date): void {
        const data: Record<string, unknown> = {};
        if (start.getTime() !== event.start_at.getTime()) data.start_at = start;
        if (end.getTime() !== event.end_at.getTime()) data.end_at = end;
        if (!Object.keys(data).length) return;
        if (isOccurrence) setPreview({ start, end });
        requestUpdate(data);
    }

    function confirmScope(scope: RecurrenceScope): void {
        const pending = pendingScope;
        if (!pending) return;
        // Same batch as the hook's synchronous optimistic update, so the chip
        // goes straight from the preview to the updated event — no flash of
        // the old position before the post-mutation refetch remounts it.
        setPendingScope(null);
        setPreview(null);
        setShowPopover(false);
        if (pending.action === "delete") {
            deleteEvent(event, scope).catch(console.error);
        } else {
            updateEvent(event, pending.data, scope).catch(console.error);
        }
    }

    function cancelScope(): void {
        setPendingScope(null);
        setPreview(null);
    }

    const handlePopoverSave = (draft: NewEventDraft): void => {
        // Only fields the user changed: an unchanged field must not overwrite
        // other occurrences' values under "all"/"following".
        const data: Record<string, unknown> = {};
        const end = new Date(draft.start_at.getTime() + draft.duration * 1000 * 60);
        if (draft.title !== event.title) data.title = draft.title;
        if (draft.description !== (event.description ?? "")) data.description = draft.description;
        if (draft.start_at.getTime() !== event.start_at.getTime()) data.start_at = draft.start_at;
        if (end.getTime() !== event.end_at.getTime()) data.end_at = end;
        if ((draft.category || null) !== (event.category || null)) data.category = draft.category;
        // Only send rrule when the picker changed it: an unchanged rule must not
        // be rewritten (the backend treats an rrule change as a series reshape).
        // Compared semantically — the picker may re-emit an equivalent rule in
        // a different form (e.g. UNTIL after a series split).
        // Send the browser timezone with it: the backend expands BYDAY/monthday
        // in the row's timezone, and older rows were stored as UTC.
        const rruleChanged = draft.rrule !== undefined && !sameRrule(draft.rrule, event.rrule, event.start_at);
        if (rruleChanged) {
            data.rrule = draft.rrule;
            data.timezone = browserTimeZone();
        }

        if (!Object.keys(data).length) {
            setShowPopover(false);
            return;
        }
        if (!isOccurrence) {
            requestUpdate(data);
            setShowPopover(false);
            return;
        }
        // The popover stays open behind the prompt so Cancel returns to the
        // edits. "This event" can't change a rule (the backend ignores rrule
        // for it), so rule changes only offer series scopes.
        requestUpdate(data, rruleChanged ? ["following", "all"] : undefined);
    }

    const handlePopoverDelete = (): void => {
        // For an occurrence the scope prompt is the confirmation.
        if (isOccurrence) setPendingScope({ action: "delete" });
        else setShowConfirmDelete(true);
    }

    function movedPastThreshold(e: MouseEvent): boolean {
        return Math.hypot(e.clientX - pressPosRef.current.x, e.clientY - pressPosRef.current.y) > DRAG_THRESHOLD;
    }

    function onMouseDown(e: React.MouseEvent): void {
        if (e.button !== 0) return;
        const chip = chipRef.current;
        if (!chip) return;
        suppressClickRef.current = false;
        pressPosRef.current = { x: e.clientX, y: e.clientY };
        const chipRect = chip.getBoundingClientRect();
        const parent = chip.offsetParent as HTMLElement | null;
        const parentRect = parent ? parent.getBoundingClientRect() : null;
        parentRectRef.current = parentRect;
        grabOffsetRef.current = {
            x: e.clientX - chipRect.left,
            y: e.clientY - chipRect.top,
        };
        setDragPos({
            left: chipRect.left - (parentRect?.left ?? 0),
            top: chipRect.top - (parentRect?.top ?? 0),
        });
        setDragging(true);
    }

    function snapTime(hour: number): {hour: number, minute: number} {
        const roundedHour = Math.round(2 * hour) / 2;
        return {hour: roundedHour, minute: 60 * (roundedHour % 1)};
    }

    function onMouseUp(e: MouseEvent): void {
        setDragging(false);
        setDragPos(null);
        const parentRect = parentRectRef.current;
        if (!parentRect || !movedPastThreshold(e)) return;
        suppressClickRef.current = true;

        // New Date objects: `event` is shared state and must stay untouched
        // until the change is committed (Cancel on the scope prompt reverts to it).
        const start = new Date(event.start_at);
        const newDayIdx = Math.min(6, Math.max(0, Math.floor(7 * (e.clientX - parentRect.left) / parentRect.width)));
        start.setDate(start.getDate() + newDayIdx - dayIdx);
        const roundedTime = snapTime(24 * (e.clientY - parentRect.top - grabOffsetRef.current.y) / parentRect.height);
        // Keep the drop inside the target day (dropping above/below the grid
        // would otherwise roll into the neighbouring day).
        const startMins = Math.min(
            Math.max(0, 60 * roundedTime.hour),
            Math.max(0, 24 * 60 - duration),
        );
        start.setHours(0, startMins, 0, 0);
        commitTimes(start, new Date(start.getTime() + duration * 1000 * 60));
    }

    function durationMouseDown(e: React.MouseEvent): void {
        e.stopPropagation();
        if (e.button !== 0) return;

        const chip = chipRef.current;
        if (!chip) return;
        suppressClickRef.current = false;
        pressPosRef.current = { x: e.clientX, y: e.clientY };
        const parent = chip.offsetParent as HTMLElement | null;
        const parentRect = parent ? parent.getBoundingClientRect() : null;
        parentRectRef.current = parentRect;

        setAdjustingDuration(true);
    }

    function durationMouseUp(e: MouseEvent): void {
        setAdjustingDuration(false);
        setResizeDuration(null);
        const parentRect = parentRectRef.current;
        if (!parentRect || !movedPastThreshold(e)) return;
        suppressClickRef.current = true;

        const startMins = 60 * event.start_at.getHours() + event.start_at.getMinutes();
        const endMins = (e.clientY - parentRect.top) / PX_PER_MIN;
        const roundedDuration = Math.max(MIN_DURATION, 30 * Math.round((endMins - startMins) / 30));
        commitTimes(event.start_at, new Date(event.start_at.getTime() + roundedDuration * 1000 * 60));
    }

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
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, [dragging]);

    useEffect(() => {
        if (!adjustingDuration) return;
        function onMove(e: MouseEvent): void {
            if (!parentRectRef.current) return;
            const startMins = 60 * event.start_at.getHours() + event.start_at.getMinutes();
            const endMins = (e.clientY - parentRectRef.current.top) / PX_PER_MIN;
            setResizeDuration(endMins - startMins);
        }

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", durationMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", durationMouseUp);
        }
    }, [adjustingDuration]);

    const color = event.category ? categoryData.filter(v => v.name === event.category)[0].color : "#8a8a99";

    const style = {
        width: `${(100 / 7) / (dragging ? 1 : cols)}%`,
        height: duration * PX_PER_MIN,
        left: dragging && dragPos ? dragPos.left : `${(dayIdx + colIdx / cols) * 100 / 7}%`,
        top: dragging && dragPos ? dragPos.top : baseTop,
        "--chip-background": color,
    };

    const rect = chipRef.current?.getBoundingClientRect();

    return (
        <div>
            <div
                ref={chipRef}
                key={event.id}
                className={`event-chip ${adjustingDuration ? "event-chip-adjusting" : ""}`}
                onMouseDown={onMouseDown}
                onClick={() => {
                    if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                    }
                    setShowPopover(true);
                }}
                onContextMenu={(e) => {e.stopPropagation(); alert("HI")}}
                style={style}
            >
                <div className="event-chip-title">
                    <span className="event-chip-title-text">{event.title}</span>
                    {event.recurring_event_id && (
                        <Repeat className="event-chip-repeat" size={10} aria-label="Repeats">
                            <title>{describeRrule(event.rrule, event.start_at)}</title>
                        </Repeat>
                    )}
                </div>
                <div className="event-chip-time">{fmtTime(shownStart)} – {fmtTime(shownEnd)}</div>
                <div className="event-chip-duration-adjuster" onMouseDown={durationMouseDown}></div>
            </div>
            {/* Inert behind the scope prompt: its form must not be edited or
                submitted while a pending change is waiting on a scope. */}
            {showPopover && <div inert={pendingScope !== null}>
                <NewEventPopover
                    anchor={{x: (rect?.right || 0) + POPOVER_GAP, y: rect?.top || 0}}
                    initialStart={event.start_at}
                    initialDuration={duration}
                    initialTitle={event.title}
                    initialDescription={event.description || ""}
                    initialCategory={event.category || ""}
                    initialRrule={event.rrule}
                    onSave={handlePopoverSave}
                    onClose={() => {setShowPopover(false)}}
                    onDelete={handlePopoverDelete}
                    setEventDraft={(_) => {}}
                />
            </div>}
            {showConfirmDelete && <ConfirmDelete
                onClose={() => {setShowConfirmDelete(false)}}
                onDelete={() => {deleteEvent(event).catch(console.error); setShowConfirmDelete(false)}}
                itemName="event"
            />}
            {pendingScope && <RecurrenceScopePrompt
                action={pendingScope.action}
                scopes={pendingScope.action === "edit" ? pendingScope.scopes : undefined}
                onCancel={cancelScope}
                onConfirm={confirmScope}
            />}
        </div>
    )
}

function EventDraftChip({ draft } : { draft: NewEventDraft }) {
    const [event, setEvent] = useState<Event>({
        id: "DRAFT",
        created_at: new Date(),
        updated_at: new Date(),
        title: draft.title,
        description: draft.description,
        start_at: draft.start_at,
        end_at: new Date(draft.start_at.getTime() + draft.duration * 1000 * 60),
        all_day: false,
        category: draft.category,
        timezone: browserTimeZone(),
        rrule: draft.rrule ?? null,
        recurring_event_id: null,
        original_start_at: null
    });

    useEffect(() => {
        setEvent(prev => ({...prev,
            title: draft.title,
            description: draft.description,
            start_at: draft.start_at,
            end_at: new Date(draft.start_at.getTime() + draft.duration * 1000 * 60)}));
    }, [draft])

    return <EventChip event={event} cols={1} colIdx={0} />
}

export default EventChip;
export {EventDraftChip}
