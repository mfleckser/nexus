import { useEvents } from "@renderer/hooks/useEvents";
import { useEffect, useRef, useState } from "react";
import { Event } from "@renderer/types";
import NewEventPopover, { NewEventDraft } from "./NewEventPopover";
import ConfirmDelete from "../../components/ConfirmDelete";
import categoryData from "./categories.json"

const PX_PER_HOUR = 48;
const PX_PER_MIN = PX_PER_HOUR / 60;
const POPOVER_GAP = 8;

const fmtTime = (d: Date) => {
    const h = d.getHours();
    const m = d.getMinutes();
    const hh = (h % 12) || 12;
    const mm = m.toString().padStart(2, "0");
    return `${hh}:${mm} ${h >= 12 ? "PM" : "AM"}`;
};

type EventChipProps = {
    event: Event,
    cols: number,
    colIdx: number
};

function EventChip({ event, cols, colIdx } : EventChipProps): React.JSX.Element {
    const chipRef = useRef<HTMLDivElement>(null);
    const parentRectRef = useRef<DOMRect | null>(null);
    const grabOffsetRef = useRef({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);
    const [adjustingDuration, setAdjustingDuration] = useState(false);
    const [duration, setDuration] = useState((event.end_at.getTime() - event.start_at.getTime()) / (1000 * 60));
    const [showPopover, setShowPopover] = useState(false);
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);

    useEffect(() => {
        setDuration((event.end_at.getTime() - event.start_at.getTime()) / (1000 * 60));
    }, [event])

    const {updateEvent, deleteEvent} = useEvents();

    const dayIdx = event.start_at.getDay();
    const baseTop = (60 * event.start_at.getHours() + event.start_at.getMinutes()) * PX_PER_MIN;

    const handlePopoverSave = (draft: NewEventDraft) => {
        updateEvent(event.id, {
            title: draft.title,
            description: draft.description,
            start_at: draft.start_at,
            end_at: new Date(draft.start_at.getTime() + draft.duration * 1000 * 60),
            category: draft.category
        });
        setShowPopover(false);
    }

    function onMouseDown(e: React.MouseEvent) {
        if (e.button !== 0) return;
        const chip = chipRef.current;
        if (!chip) return;
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

    function onMouseUp(e: MouseEvent) {
        if (parentRectRef.current) {
            // Set new day
            const newDayIdx = 7 * (e.clientX - parentRectRef.current.left) / parentRectRef.current.width;
            event.start_at.setDate(event.start_at.getDate() + newDayIdx - dayIdx);
            event.end_at.setDate(event.end_at.getDate() + newDayIdx - dayIdx);

            // Set new hour
            const newHour = 24 * (e.clientY - parentRectRef.current.top - grabOffsetRef.current.y) / parentRectRef.current.height;
            const roundedTime = snapTime(newHour);
            event.start_at.setHours(roundedTime.hour, roundedTime.minute);
            event.end_at.setTime(event.start_at.getTime() + duration * 1000 * 60);

            updateEvent(event.id, {start_at: event.start_at, end_at: event.end_at});
        }
        setDragging(false);
        setDragPos(null);
    }

    function durationMouseDown(e: React.MouseEvent) {
        e.stopPropagation();

        const chip = chipRef.current;
        if (!chip) return;
        const parent = chip.offsetParent as HTMLElement | null;
        const parentRect = parent ? parent.getBoundingClientRect() : null;
        parentRectRef.current = parentRect;

        setAdjustingDuration(true);
    }

    function durationMouseUp(e: MouseEvent) {
        setAdjustingDuration(false);
        if (parentRectRef.current) {
            const startMins = 60 * event.start_at.getHours() + event.start_at.getMinutes();
            const endMins = (e.clientY - parentRectRef.current.top) / PX_PER_MIN;
            const roundedDuration = 30 * Math.round((endMins - startMins) / 30);
            setDuration(roundedDuration);
            event.end_at.setTime(event.start_at.getTime() + roundedDuration * 1000 * 60)
            updateEvent(event.id, {end_at: event.end_at})
        }
    }

    useEffect(() => {
        if (!dragging) return;
        function onMove(e: MouseEvent) {
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
        function onMove(e: MouseEvent) {
            if (!parentRectRef.current) return;
            const startMins = 60 * event.start_at.getHours() + event.start_at.getMinutes();
            const endMins = (e.clientY - parentRectRef.current.top) / PX_PER_MIN;
            setDuration(endMins - startMins);
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
                onClick={() => {setShowPopover(true)}}
                onContextMenu={(e) => {e.stopPropagation(); alert("HI")}}
                style={style}
            >
                <div className="event-chip-title">{event.title}</div>
                <div className="event-chip-time">{fmtTime(event.start_at)} – {fmtTime(event.end_at)}</div>
                <div className="event-chip-duration-adjuster" onMouseDown={durationMouseDown}></div>
            </div>
            {showPopover &&
                <NewEventPopover
                    anchor={{x: (rect?.right || 0) + POPOVER_GAP, y: rect?.top || 0}}
                    initialStart={event.start_at}
                    initialDuration={duration}
                    initialTitle={event.title}
                    initialDescription={event.description || ""}
                    initialCategory={event.category || ""}
                    onSave={handlePopoverSave}
                    onClose={() => {setShowPopover(false)}}
                    onDelete={() => {setShowConfirmDelete(true)}}
                    setEventDraft={(_) => {}}
                />}
            {showConfirmDelete && <ConfirmDelete
                onClose={() => {setShowConfirmDelete(false)}}
                onDelete={() => {deleteEvent(event.id); setShowConfirmDelete(false)}}
                itemName="event"
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
        category: draft.category
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
