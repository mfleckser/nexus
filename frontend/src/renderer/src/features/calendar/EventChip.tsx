import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Repeat } from "lucide-react";
import { useEvents } from "@renderer/features/calendar/useEvents";
import { EventUpdate } from "@renderer/features/calendar/events.api";
import { CalendarEvent, NewEventDraft, RecurrenceScope } from "@renderer/types";
import NewEventPopover from "@renderer/features/calendar/NewEventPopover";
import ConfirmDelete from "@renderer/components/ConfirmDelete";
import RecurrenceScopePrompt from "@renderer/components/RecurrenceScopePrompt";
import { categoryColor } from "@renderer/features/calendar/categories";
import {
    DRAG_THRESHOLD,
    MIN_EVENT_MINUTES,
    POPOVER_GAP,
    PX_PER_MIN,
    SLOT_MINUTES,
} from "@renderer/features/calendar/constants";
import {
    addDays,
    atMinutes,
    browserTimeZone,
    calendarDaysBetween,
    formatTime as fmtTime,
    minutesIntoDay,
    MINUTES_PER_DAY,
    shiftDays,
} from "@renderer/lib/time";
import { describeRrule, sameRrule } from "@renderer/lib/rrule";
import { DaySegment, daySegment } from "@renderer/lib/eventLayout";
import useReportError from "@renderer/hooks/useReportError";
import { PopoverAnchor } from "@renderer/hooks/usePopoverPosition";

// Chips shorter than this (px) show title and time on a single line.
const COMPACT_CHIP_PX = 30;

const snap = (minutes: number): number => SLOT_MINUTES * Math.round(minutes / SLOT_MINUTES);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// A mutation of a recurring occurrence waiting on the scope prompt.
type PendingScope = { action: "edit"; data: EventUpdate; scopes?: RecurrenceScope[] } | { action: "delete" };

type ChipBox = { dayIndex: number; startMin: number; endMin: number };

function chipStyle(box: ChipBox, column: number, columns: number, color: string): React.CSSProperties {
    return {
        width: `${100 / 7 / columns}%`,
        height: (box.endMin - box.startMin) * PX_PER_MIN,
        left: `${((box.dayIndex + column / columns) * 100) / 7}%`,
        top: box.startMin * PX_PER_MIN,
        ["--chip-background" as string]: color,
    };
}

type EventChipProps = {
    // This chip's day slice of the event (multi-day events render one chip per day).
    segment: DaySegment<CalendarEvent>;
};

function EventChip({ segment }: EventChipProps): React.JSX.Element {
    const event = segment.item;
    const chipRef = useRef<HTMLDivElement>(null);
    const parentRectRef = useRef<DOMRect | null>(null);
    const grabOffsetRef = useRef({ x: 0, y: 0 });
    const pressPosRef = useRef({ x: 0, y: 0 });
    // Set when a real drag/resize ends, so the click that follows the mouseup
    // doesn't also open the edit popover.
    const suppressClickRef = useRef(false);
    const [dragging, setDragging] = useState(false);
    const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);
    const [resizing, setResizing] = useState(false);
    // Snapped end (minutes into this segment's day) while resizing.
    const [resizeEndMin, setResizeEndMin] = useState<number | null>(null);
    // Dropped/resized times of a recurring occurrence, shown while the scope
    // prompt is open. Nothing is committed until a scope is chosen; Cancel
    // just clears this and the chip falls back to `event`.
    const [preview, setPreview] = useState<{ start: Date; end: Date } | null>(null);
    const [pendingScope, setPendingScope] = useState<PendingScope | null>(null);
    // Edit popover anchor, captured from the chip's rect on open; null = closed.
    const [popoverAnchor, setPopoverAnchor] = useState<PopoverAnchor | null>(null);
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);

    const { updateEvent, deleteEvent } = useEvents();
    const reportError = useReportError();

    const isOccurrence = event.recurring_event_id !== null;
    const eventMinutes = (event.end_at.getTime() - event.start_at.getTime()) / 60000;
    const singleDay = !segment.clippedStart && !segment.clippedEnd;

    // Where the chip sits: the pending preview's slice of the (shifted) day,
    // the live resize, or the segment itself.
    let box: ChipBox = segment;
    if (preview) {
        const days = calendarDaysBetween(event.start_at, preview.start);
        const day = addDays(segment.dayStart, days);
        const shifted = daySegment({ start_at: preview.start, end_at: preview.end }, 0, day, addDays(day, 1));
        if (shifted) box = { dayIndex: segment.dayIndex + days, startMin: shifted.startMin, endMin: shifted.endMin };
    } else if (resizeEndMin !== null) {
        box = { ...segment, endMin: resizeEndMin };
    }
    const shownStart = preview?.start ?? event.start_at;
    const shownEnd = preview?.end ?? (resizeEndMin !== null ? atMinutes(segment.dayStart, resizeEndMin) : event.end_at);

    const style = chipStyle(box, segment.column, segment.columns, categoryColor(event.category));
    if (dragging && dragPos) Object.assign(style, { left: dragPos.left, top: dragPos.top, width: `${100 / 7}%` });
    const compact = (box.endMin - box.startMin) * PX_PER_MIN < COMPACT_CHIP_PX;

    // Plain events commit straight away; occurrences wait for a scope.
    function requestUpdate(data: EventUpdate, scopes?: RecurrenceScope[]): void {
        if (!isOccurrence) {
            updateEvent(event, data).catch((err) => reportError("Couldn't save event", err));
            return;
        }
        setPendingScope({ action: "edit", data, scopes });
    }

    // Drag/resize result. Only changed fields are sent; a drop back onto the
    // same slot sends nothing.
    function commitTimes(start: Date, end: Date): void {
        const data: EventUpdate = {};
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
        setPopoverAnchor(null);
        if (pending.action === "delete") {
            deleteEvent(event, scope).catch((err) => reportError("Couldn't delete event", err));
        } else {
            updateEvent(event, pending.data, scope).catch((err) => reportError("Couldn't save event", err));
        }
    }

    function cancelScope(): void {
        setPendingScope(null);
        setPreview(null);
    }

    const handlePopoverSave = (draft: NewEventDraft): void => {
        // Only fields the user changed: an unchanged field must not overwrite
        // other occurrences' values under "all"/"following".
        const data: EventUpdate = {};
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
            setPopoverAnchor(null);
            return;
        }
        if (!isOccurrence) {
            requestUpdate(data);
            setPopoverAnchor(null);
            return;
        }
        // The popover stays open behind the prompt so Cancel returns to the
        // edits. "This event" can't change a rule (the backend ignores rrule
        // for it), so rule changes only offer series scopes.
        requestUpdate(data, rruleChanged ? ["following", "all"] : undefined);
    };

    const handlePopoverDelete = (): void => {
        // For an occurrence the scope prompt is the confirmation.
        if (isOccurrence) setPendingScope({ action: "delete" });
        else setShowConfirmDelete(true);
    };

    function openPopover(): void {
        const rect = chipRef.current?.getBoundingClientRect();
        if (!rect) return;
        setPopoverAnchor({ x: rect.right + POPOVER_GAP, y: rect.top, flipX: rect.left - POPOVER_GAP });
    }

    function movedPastThreshold(e: MouseEvent): boolean {
        return Math.hypot(e.clientX - pressPosRef.current.x, e.clientY - pressPosRef.current.y) > DRAG_THRESHOLD;
    }

    // Records the press and the grid's rect; false if the chip isn't mounted.
    function beginPress(e: React.MouseEvent): boolean {
        const chip = chipRef.current;
        if (!chip) return false;
        suppressClickRef.current = false;
        pressPosRef.current = { x: e.clientX, y: e.clientY };
        const parent = chip.offsetParent as HTMLElement | null;
        parentRectRef.current = parent ? parent.getBoundingClientRect() : null;
        return true;
    }

    function onMouseDown(e: React.MouseEvent): void {
        if (e.button !== 0 || !beginPress(e)) return;
        const chipRect = chipRef.current!.getBoundingClientRect();
        const parentRect = parentRectRef.current;
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

    const onDragMove = useEffectEvent((e: MouseEvent) => {
        const parentRect = parentRectRef.current;
        if (!parentRect) return;
        setDragPos({
            left: e.clientX - parentRect.left - grabOffsetRef.current.x,
            top: e.clientY - parentRect.top - grabOffsetRef.current.y,
        });
    });

    const onDragEnd = useEffectEvent((e: MouseEvent) => {
        setDragging(false);
        setDragPos(null);
        const parentRect = parentRectRef.current;
        if (!parentRect || !movedPastThreshold(e)) return;
        suppressClickRef.current = true;

        const newDayIdx = clamp(Math.floor((7 * (e.clientX - parentRect.left)) / parentRect.width), 0, 6);
        const dayDelta = newDayIdx - segment.dayIndex;
        const droppedTopMin = (e.clientY - parentRect.top - grabOffsetRef.current.y) / PX_PER_MIN;
        let start: Date;
        if (singleDay) {
            // Snap the start onto the grid, keeping the event inside the
            // target day (dropping above/below the grid would otherwise roll
            // into the neighbouring day).
            const startMin = clamp(snap(droppedTopMin), 0, Math.max(0, MINUTES_PER_DAY - eventMinutes));
            start = atMinutes(addDays(segment.dayStart, dayDelta), startMin);
        } else {
            // A slice of a multi-day event: shift the whole event by however
            // far this slice moved.
            start = shiftDays(event.start_at, dayDelta);
            start.setMinutes(start.getMinutes() + snap(droppedTopMin - segment.startMin));
        }
        commitTimes(start, new Date(start.getTime() + eventMinutes * 60000));
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

    // Only the slice holding the event's real end gets a resize handle.
    function resizeMouseDown(e: React.MouseEvent): void {
        e.stopPropagation();
        if (e.button !== 0 || !beginPress(e)) return;
        setResizing(true);
    }

    // New end (minutes into this slice's day) for the pointer's y, snapped,
    // at least MIN_EVENT_MINUTES after the event's start and within the day.
    function resizedEndMin(clientY: number, parentRect: DOMRect): number {
        const pointerMin = (clientY - parentRect.top) / PX_PER_MIN;
        const endMin = segment.startMin + snap(pointerMin - segment.startMin);
        let minEnd = segment.startMin + MIN_EVENT_MINUTES;
        if (segment.clippedStart) {
            // The event began on an earlier day: keep at least one slot here,
            // and MIN_EVENT_MINUTES overall if it started just before midnight.
            const earliestEnd = new Date(event.start_at.getTime() + MIN_EVENT_MINUTES * 60000);
            minEnd = Math.max(SLOT_MINUTES, earliestEnd > segment.dayStart ? minutesIntoDay(earliestEnd) : 0);
        }
        return clamp(endMin, Math.min(minEnd, MINUTES_PER_DAY), MINUTES_PER_DAY);
    }

    const onResizeMove = useEffectEvent((e: MouseEvent) => {
        if (parentRectRef.current) setResizeEndMin(resizedEndMin(e.clientY, parentRectRef.current));
    });

    const onResizeEnd = useEffectEvent((e: MouseEvent) => {
        setResizing(false);
        setResizeEndMin(null);
        const parentRect = parentRectRef.current;
        if (!parentRect || !movedPastThreshold(e)) return;
        suppressClickRef.current = true;
        commitTimes(event.start_at, atMinutes(segment.dayStart, resizedEndMin(e.clientY, parentRect)));
    });

    useEffect(() => {
        if (!resizing) return;
        window.addEventListener("mousemove", onResizeMove);
        window.addEventListener("mouseup", onResizeEnd);
        return () => {
            window.removeEventListener("mousemove", onResizeMove);
            window.removeEventListener("mouseup", onResizeEnd);
        };
    }, [resizing]);

    return (
        <div>
            <div
                ref={chipRef}
                className={`event-chip${resizing ? " event-chip-adjusting" : ""}${compact ? " event-chip-compact" : ""}`}
                role="button"
                tabIndex={0}
                aria-expanded={popoverAnchor !== null}
                onMouseDown={onMouseDown}
                onClick={() => {
                    if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                    }
                    openPopover();
                }}
                onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    openPopover();
                }}
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
                <div className="event-chip-time">
                    {fmtTime(shownStart)} – {fmtTime(shownEnd)}
                </div>
                {!segment.clippedEnd && (
                    <div className="event-chip-duration-adjuster" onMouseDown={resizeMouseDown}></div>
                )}
            </div>
            {/* Inert behind the scope prompt: its form must not be edited or
                submitted while a pending change is waiting on a scope. */}
            {popoverAnchor && (
                <div inert={pendingScope !== null}>
                    <NewEventPopover
                        anchor={popoverAnchor}
                        initialStart={event.start_at}
                        initialDuration={eventMinutes}
                        initialTitle={event.title}
                        initialDescription={event.description || ""}
                        initialCategory={event.category || ""}
                        initialRrule={event.rrule}
                        onSave={handlePopoverSave}
                        onClose={() => setPopoverAnchor(null)}
                        onDelete={handlePopoverDelete}
                    />
                </div>
            )}
            {showConfirmDelete && (
                <ConfirmDelete
                    onClose={() => setShowConfirmDelete(false)}
                    onDelete={() => {
                        deleteEvent(event).catch((err) => reportError("Couldn't delete event", err));
                        setShowConfirmDelete(false);
                    }}
                    itemName="event"
                />
            )}
            {pendingScope && (
                <RecurrenceScopePrompt
                    action={pendingScope.action}
                    scopes={pendingScope.action === "edit" ? pendingScope.scopes : undefined}
                    onCancel={cancelScope}
                    onConfirm={confirmScope}
                />
            )}
        </div>
    );
}

type EventDraftPreviewProps = {
    draft: NewEventDraft;
    // Local midnight of the first visible day.
    weekStart: Date;
};

// Non-interactive placeholder for an event being created (drag-to-create or
// the new-event popover). Hidden when the draft starts outside the week.
function EventDraftPreview({ draft, weekStart }: EventDraftPreviewProps): React.JSX.Element | null {
    const dayIndex = calendarDaysBetween(weekStart, draft.start_at);
    if (dayIndex < 0 || dayIndex > 6) return null;
    const startMin = minutesIntoDay(draft.start_at);
    const endMin = Math.min(MINUTES_PER_DAY, startMin + draft.duration);
    const end = new Date(draft.start_at.getTime() + draft.duration * 60000);
    const compact = (endMin - startMin) * PX_PER_MIN < COMPACT_CHIP_PX;
    return (
        <div
            className={`event-chip event-chip-draft${compact ? " event-chip-compact" : ""}`}
            style={chipStyle({ dayIndex, startMin, endMin }, 0, 1, categoryColor(draft.category))}
            aria-hidden
        >
            <div className="event-chip-title">
                <span className="event-chip-title-text">{draft.title || "(No title)"}</span>
            </div>
            <div className="event-chip-time">
                {fmtTime(draft.start_at)} – {fmtTime(end)}
            </div>
        </div>
    );
}

export default EventChip;
export { EventDraftPreview };
