import { useEffect, useRef, useState } from "react";
import "./calendar.css"
import { Event } from "@renderer/types";
import { useEvents } from "@renderer/hooks/useEvents";

const PX_PER_HOUR = 48;
const PX_PER_MIN = PX_PER_HOUR / 60;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

const fmtTime = (d: Date) => {
    const h = d.getHours();
    const m = d.getMinutes();
    const hh = (h % 12) || 12;
    const mm = m.toString().padStart(2, "0");
    return `${hh}:${mm} ${h >= 12 ? "PM" : "AM"}`;
};

type EventChipProps = {
    event: Event
};

function EventChip({ event } : EventChipProps): React.JSX.Element {
    const chipRef = useRef<HTMLDivElement>(null);
    const parentRectRef = useRef<DOMRect | null>(null);
    const grabOffsetRef = useRef({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);

    const {updateEvent} = useEvents();

    const dayIdx = event.start_at.getDay();
    const baseTop = (60 * event.start_at.getHours() + event.start_at.getMinutes()) * PX_PER_MIN;
    const duration = (event.end_at.getTime() - event.start_at.getTime()) / (1000 * 60);

    function onMouseDown(e: React.MouseEvent) {
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

    function onMouseUp(e: MouseEvent) {
        if (parentRectRef.current) {
            // Set new day
            const newDayIdx = 7 * (e.clientX - parentRectRef.current.left) / parentRectRef.current.width;
            event.start_at.setDate(event.start_at.getDate() + newDayIdx - dayIdx);
            event.end_at.setDate(event.end_at.getDate() + newDayIdx - dayIdx);

            // Set new hour
            const newHour = 24 * (e.clientY - parentRectRef.current.top - grabOffsetRef.current.y) / parentRectRef.current.height;
            const roundedHour = Math.round(2 * newHour) / 2;
            event.start_at.setHours(roundedHour, 60 * (roundedHour % 1));
            event.end_at.setTime(event.start_at.getTime() + duration * 1000 * 60);

            updateEvent(event.id, {start_at: event.start_at, end_at: event.end_at});
        }
        setDragging(false);
        setDragPos(null);
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

    const style: React.CSSProperties = {
        width: `${100 / 7}%`,
        height: duration * PX_PER_MIN,
        left: dragging && dragPos ? dragPos.left : `${dayIdx * 100 / 7}%`,
        top: dragging && dragPos ? dragPos.top : baseTop,
    };

    return (
        <div
            ref={chipRef}
            key={event.id}
            className="event-chip"
            onMouseDown={onMouseDown}
            style={style}
        >
            <div className="event-chip-title">{event.title}</div>
            <div className="event-chip-time">{fmtTime(event.start_at)} – {fmtTime(event.end_at)}</div>
        </div>
    )
}

type PositionedEvent = { event: Event; col: number; colCount: number };

const buildEventLayout = (events: Event[], weekStart: Date): PositionedEvent[][] => {
    const byDay: Event[][] = Array.from({ length: 7 }, () => []);
    const weekEnd = new Date(weekStart.getTime() + 7 * MS_PER_DAY);
    for (const ev of events) {
        if (ev.start_at >= weekEnd || ev.end_at <= weekStart) continue;
        const dayIdx = Math.floor((ev.start_at.getTime() - weekStart.getTime()) / MS_PER_DAY);
        if (dayIdx >= 0 && dayIdx < 7) byDay[dayIdx].push(ev);
    }
    return byDay.map(dayEvents => {
        const sorted = [...dayEvents].sort((a, b) =>
            a.start_at.getTime() - b.start_at.getTime() ||
            b.end_at.getTime() - a.end_at.getTime()
        );
        // Group connected overlapping events (cluster), then assign cols greedily within cluster.
        const result: PositionedEvent[] = [];
        let cluster: Event[] = [];
        let clusterEnd = -Infinity;
        const flush = () => {
            if (!cluster.length) return;
            const cols: Event[][] = [];
            const colByEvent = new Map<string, number>();
            for (const ev of cluster) {
                let placed = false;
                for (let i = 0; i < cols.length; i++) {
                    const last = cols[i][cols[i].length - 1];
                    if (last.end_at <= ev.start_at) {
                        cols[i].push(ev);
                        colByEvent.set(ev.id, i);
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    cols.push([ev]);
                    colByEvent.set(ev.id, cols.length - 1);
                }
            }
            const colCount = cols.length;
            for (const ev of cluster) {
                result.push({ event: ev, col: colByEvent.get(ev.id)!, colCount });
            }
            cluster = [];
            clusterEnd = -Infinity;
        };
        for (const ev of sorted) {
            if (ev.start_at.getTime() >= clusterEnd) flush();
            cluster.push(ev);
            clusterEnd = Math.max(clusterEnd, ev.end_at.getTime());
        }
        flush();
        return result;
    });
};

function Calendar(): React.JSX.Element {
    const today = new Date();
    const [focusedDay, setFocusedDay] = useState<Date>(() => {
        return new Date(today.getTime() - today.getDay() * 1000 * 60 * 60 * 24)
    });
    const [viewType, setViewType] = useState("WEEK");
    const {events} = useEvents();

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const isToday = (d: Date) =>
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear();

    const formatHour = (hour: number) => {
        if (hour === 0) return "";
        const h = (hour % 12) || 12;
        return `${h} ${hour >= 12 ? "PM" : "AM"}`;
    };

    const startOfWeek = (d: Date) =>
        new Date(d.getTime() - d.getDay() * 1000 * 60 * 60 * 24);

    const goPrev = () => {
        setFocusedDay(prev =>
            viewType === "MONTH"
                ? new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
                : new Date(prev.getTime() - 1000 * 60 * 60 * 24 * 7)
        );
    };

    const goNext = () => {
        setFocusedDay(prev =>
            viewType === "MONTH"
                ? new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
                : new Date(prev.getTime() + 1000 * 60 * 60 * 24 * 7)
        );
    };

    const goToday = () => {
        setFocusedDay(today);
    };

    const onViewChange = (v: string) => {
        setViewType(v);
    };

    function handleKeyPress(event) {
        const active = document.activeElement;
        if (active) {
            const tag = active.tagName.toLowerCase();
            if (tag === "input" || tag == "textarea" || (active as HTMLElement).isContentEditable) {
                return;
            }
        }
        if (event.key === "ArrowLeft") {
            goPrev();
        } else if (event.key === "ArrowRight") {
            goNext();
        } else if (event.key === "w") {
            setViewType("WEEK");
        } else if (event.key === "m") {
            setViewType("MONTH");
        } else if (event.key === "t") {
            goToday();
        }
    }

    useEffect(() => {
        window.addEventListener("keydown", handleKeyPress);
        return () => {window.removeEventListener("keydown", handleKeyPress)}
    }, [focusedDay, viewType]);

    const monthCells = (() => {
        if (viewType !== "MONTH") return [];
        const firstOfMonth = new Date(focusedDay.getFullYear(), focusedDay.getMonth(), 1);
        const lastOfMonth = new Date(focusedDay.getFullYear(), focusedDay.getMonth() + 1, 0);
        const gridStart = new Date(firstOfMonth);
        gridStart.setDate(1 - firstOfMonth.getDay());
        const gridEnd = new Date(lastOfMonth);
        gridEnd.setDate(lastOfMonth.getDate() + (6 - lastOfMonth.getDay()));
        const cells: Date[] = [];
        const cursor = new Date(gridStart);
        while (cursor <= gridEnd) {
            cells.push(new Date(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }
        return cells;
    })();

    const calcCursorPos = (): React.CSSProperties => {
        const now = new Date();
        const left = now.getDay() * 100 / 7;
        const top = (now.getHours() * 60 + now.getMinutes()) * PX_PER_MIN
        
        return {
            left: `${left}%`,
            top: top
        }
    }

    return (
        <div id="calendar-container">
            <div id="calendar-header">
                <div className="header-left">
                    <button className="today-button" onClick={goToday}>Today</button>
                    <div className="nav-group">
                        <button className="nav-button" aria-label="Previous" onClick={goPrev}>‹</button>
                        <button className="nav-button" aria-label="Next" onClick={goNext}>›</button>
                    </div>
                    <span className="month-year-label">{monthNames[focusedDay.getMonth()]} {focusedDay.getFullYear()}</span>
                </div>
                <div className="select-wrapper">
                    <select
                        className="view-select"
                        value={viewType}
                        onChange={e => onViewChange(e.target.value)}
                    >
                        <option value="DAY">Day</option>
                        <option value="WEEK">Week</option>
                        <option value="MONTH">Month</option>
                    </select>
                </div>
            </div>
            {viewType === "MONTH" ? (
                <div id="month-container">
                    <div className="month-header">
                        {dayNames.map(name => (
                            <div key={name} className="day-header">
                                <span className="day-name">{name}</span>
                            </div>
                        ))}
                    </div>
                    <div className="month-grid">
                        {monthCells.map((d, i) => {
                            const outOfMonth = d.getMonth() !== focusedDay.getMonth();
                            return (
                                <div
                                    key={i}
                                    className={`month-day-cell${isToday(d) ? " today-cell" : ""}${outOfMonth ? " out-of-month" : ""}`}
                                >
                                    <span className="date-num">{d.getDate()}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <div id="week-container">
                    <div className="gutter-spacer" />
                    <div className="header-container">
                        {[...Array(7).keys()].map(idx => {
                            const d = startOfWeek(focusedDay);
                            d.setDate(d.getDate() + idx);
                            return (
                                <div key={idx} className={`day-header${isToday(d) ? " today-header" : ""}`}>
                                    <span className="day-name">{dayNames[idx]}</span>
                                    <span className="date-num">{d.getDate()}</span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="gutter-spacer all-day-gutter" />
                    <div className="all-day-container">
                        {[...Array(7).keys()].map(idx => (
                            <div key={idx} className="all-day-cell" />
                        ))}
                    </div>
                    <div className="day-events-scroll">
                        <div className="day-events">
                            {[...Array(24).keys()].map(hour => (
                                <>
                                    <div key={`label-${hour}`} className="hour-label">{formatHour(hour)}</div>
                                    {[...Array(7).keys()].map(day => (
                                        <div key={`${hour}-${day}`} className="hour-block" />
                                    ))}
                                </>
                            ))}
                            <div className="events-overlay">
                                {events.filter(e => startOfWeek(e.start_at).toDateString() === startOfWeek(focusedDay).toDateString()).map(event => <EventChip event={event} /> )}
                                <div className="cursor-now" style={calcCursorPos()}></div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Calendar