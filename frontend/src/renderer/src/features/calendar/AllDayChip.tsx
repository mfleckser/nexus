import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Repeat } from "lucide-react";
import { CalendarEvent, Task } from "@renderer/types";
import useEventEditor, { timesUpdate } from "@renderer/features/calendar/useEventEditor";
import { categoryColor } from "@renderer/features/calendar/categories";
import { ALL_DAY_ROW_PX, DRAG_THRESHOLD } from "@renderer/features/calendar/constants";
import { allDayTimes, daySpan, DayBar } from "@renderer/lib/allDay";
import { addDays } from "@renderer/lib/time";
import { describeRrule } from "@renderer/lib/rrule";

// Day column under clientX, unclamped, in a row of `dayCount` columns.
const columnAt = (clientX: number, rect: DOMRect, dayCount: number): number =>
    Math.floor((dayCount * (clientX - rect.left)) / rect.width);

// Horizontal placement over `span` columns from `startIndex`, inset by the
// chip's side margins.
const barBox = (startIndex: number, span: number, dayCount: number): React.CSSProperties => ({
    left: `${(startIndex * 100) / dayCount}%`,
    width: `calc(${(span * 100) / dayCount}% - 4px)`,
});

type AllDayChipProps = {
    bar: DayBar<CalendarEvent>;
    // Day columns in the row: 7 in week view, 1 in day view.
    dayCount: number;
    // Tasks this event is a time block for.
    linkedTasks: Task[];
};

// An all-day event's bar in the all-day row. Click to edit; drag sideways to
// move it by whole days.
function AllDayChip({ bar, dayCount, linkedTasks }: AllDayChipProps): React.JSX.Element {
    const event = bar.item;
    const chipRef = useRef<HTMLDivElement>(null);
    const rowRectRef = useRef<DOMRect | null>(null);
    const pressRef = useRef({ x: 0, y: 0, column: 0 });
    // Set when a real drag ends, so the click after the mouseup doesn't open the popover.
    const suppressClickRef = useRef(false);
    const [dragging, setDragging] = useState(false);
    // Days the bar is dragged (live) or dropped (waiting on the scope prompt) by.
    const [shift, setShift] = useState(0);
    const { isOccurrence, popoverOpen, openPopover, requestUpdate, overlays } = useEventEditor(event, linkedTasks, () =>
        setShift(0),
    );

    const style: React.CSSProperties = {
        ...barBox(bar.startIndex + shift, bar.span, dayCount),
        top: bar.row * ALL_DAY_ROW_PX,
        ["--chip-background" as string]: categoryColor(event.category),
    };

    function onMouseDown(e: React.MouseEvent): void {
        const parent = chipRef.current?.offsetParent;
        if (e.button !== 0 || !parent) return;
        // Stays clear of the row's drag-to-create.
        e.stopPropagation();
        e.preventDefault();
        suppressClickRef.current = false;
        const rect = parent.getBoundingClientRect();
        rowRectRef.current = rect;
        pressRef.current = { x: e.clientX, y: e.clientY, column: columnAt(e.clientX, rect, dayCount) };
        setDragging(true);
    }

    const onDragMove = useEffectEvent((e: MouseEvent) => {
        const rect = rowRectRef.current;
        if (rect) setShift(columnAt(e.clientX, rect, dayCount) - pressRef.current.column);
    });

    const onDragEnd = useEffectEvent((e: MouseEvent) => {
        setDragging(false);
        const rect = rowRectRef.current;
        const moved = Math.hypot(e.clientX - pressRef.current.x, e.clientY - pressRef.current.y) > DRAG_THRESHOLD;
        const days = rect ? columnAt(e.clientX, rect, dayCount) - pressRef.current.column : 0;
        if (moved) suppressClickRef.current = true;
        if (!moved || days === 0) {
            setShift(0);
            return;
        }
        const { first, last } = daySpan(event);
        const { start_at, end_at } = allDayTimes(addDays(first, days), addDays(last, days));
        // Occurrences keep the shifted preview until the scope prompt settles.
        if (!isOccurrence) setShift(0);
        requestUpdate(timesUpdate(event, start_at, end_at, true));
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

    function openFromChip(): void {
        const rect = chipRef.current?.getBoundingClientRect();
        if (rect) openPopover(rect);
    }

    const className =
        "all-day-chip" +
        (bar.clippedStart ? " all-day-chip-clipped-start" : "") +
        (bar.clippedEnd ? " all-day-chip-clipped-end" : "") +
        (dragging ? " all-day-chip-dragging" : "");

    return (
        <>
            <div
                ref={chipRef}
                className={className}
                role="button"
                tabIndex={0}
                aria-expanded={popoverOpen}
                style={style}
                onMouseDown={onMouseDown}
                onClick={() => {
                    if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                    }
                    openFromChip();
                }}
                onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    openFromChip();
                }}
            >
                <span className="all-day-chip-title">{event.title}</span>
                {isOccurrence && (
                    <Repeat className="event-chip-repeat" size={10} aria-label="Repeats">
                        <title>{describeRrule(event.rrule, event.start_at)}</title>
                    </Repeat>
                )}
            </div>
            {overlays}
        </>
    );
}

type AllDayDraftPreviewProps = {
    title: string;
    category: string;
    startIndex: number;
    span: number;
    row: number;
    dayCount: number;
};

// Placeholder bar for an all-day event being created.
export function AllDayDraftPreview({
    title,
    category,
    startIndex,
    span,
    row,
    dayCount,
}: AllDayDraftPreviewProps): React.JSX.Element {
    return (
        <div
            className="all-day-chip all-day-chip-draft"
            style={{
                ...barBox(startIndex, span, dayCount),
                top: row * ALL_DAY_ROW_PX,
                ["--chip-background" as string]: categoryColor(category),
            }}
            aria-hidden
        >
            <span className="all-day-chip-title">{title || "(No title)"}</span>
        </div>
    );
}

export default AllDayChip;
