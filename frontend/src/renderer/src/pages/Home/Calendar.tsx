import { useCallback, useEffect, useState } from "react";
import "./calendar.css"
import { useEvents } from "@renderer/hooks/useEvents";
import EventChip, { EventDraftChip } from "./EventChip";
import NewEventPopover, { NewEventDraft } from "./NewEventPopover";
import useNow from "@renderer/hooks/useNow";

const PX_PER_HOUR = 48;
const PX_PER_MIN = PX_PER_HOUR / 60;
const POPOVER_WIDTH = 320;
const POPOVER_GAP = 8;

function Calendar(): React.JSX.Element {
    const today = new Date();
    const now = useNow();
    const [focusedDay, setFocusedDay] = useState<Date>(() => {
        return new Date(today.getTime() - today.getDay() * 1000 * 60 * 60 * 24)
    });
    const [viewType, setViewType] = useState("WEEK");
    const {events, addEvent} = useEvents();
    const [popover, setPopover] = useState<{ anchor: { x: number; y: number }; start: Date; duration?: number } | null>(null);
    const [eventDraft, setEventDraft] = useState<NewEventDraft | null>(null);

    const clampPopoverAnchor = (x: number, y: number) => {
        const margin = 12;
        const maxX = window.innerWidth - POPOVER_WIDTH - margin;
        const maxY = window.innerHeight - 360;
        return {
            x: Math.max(margin, Math.min(x, maxX)),
            y: Math.max(margin, Math.min(y, maxY)),
        };
    };

    const openNewEventAt = (start: Date, anchor: { x: number; y: number }, duration: number = 60) => {
        setPopover({ anchor: clampPopoverAnchor(anchor.x, anchor.y), start, duration });
    };

    const handleSlotMouseMove = useCallback((ev: MouseEvent) => {
        setEventDraft(prev => prev && ({...prev, duration: prev.duration + (ev.movementY / PX_PER_MIN)}));
    }, []);

    const handleSlotMouseDown = (day: number, hour: number) => (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const minuteOffset = ((e.clientY - rect.top) / rect.height) * 60;
        const snappedMinute = Math.round(minuteOffset / 30) * 30;
        const base = startOfWeek(focusedDay);
        const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() + day, hour, snappedMinute);
        setEventDraft({title: "", description: "", start_at: start, duration: 0, top: rect.top, category: "none"});
        
        window.addEventListener("mousemove", handleSlotMouseMove);
    }

    useEffect(() => window.removeEventListener("mousemove", handleSlotMouseMove), []);

    const handleSlotMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!eventDraft) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const roundedDuration = eventDraft.duration ? Math.round(eventDraft.duration / 30) * 30 : 60;
        openNewEventAt(eventDraft.start_at, { x: rect.right + POPOVER_GAP, y: eventDraft.top || rect.top }, roundedDuration);

        window.removeEventListener("mousemove", handleSlotMouseMove);
    }

    const handleNewEventButton = (e: React.MouseEvent<HTMLButtonElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const now = new Date();
        now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
        openNewEventAt(now, { x: rect.left, y: rect.bottom + POPOVER_GAP });
    };

    const handlePopoverSave = (draft: NewEventDraft) => {
        addEvent(draft);
        setPopover(null);
        setEventDraft(null);
    };

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const isToday = (d: Date) =>
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();

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
        setFocusedDay(now);
    };

    const onViewChange = (v: string) => {
        setViewType(v);
    };

    function handleKeyPress(event) {
        const active = document.activeElement;
        if (active) {
            // Don't process keyboard shortcuts while typing
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
                    <button className="new-event-button" onClick={handleNewEventButton}>+ New Event</button>
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
                                        <div
                                            key={`${hour}-${day}`}
                                            className="hour-block"
                                            onMouseDown={handleSlotMouseDown(day, hour)}
                                            onMouseUp={handleSlotMouseUp}
                                        />
                                    ))}
                                </>
                            ))}
                            <div className="events-overlay">
                                {events.filter(e => startOfWeek(e.start_at).toDateString() === startOfWeek(focusedDay).toDateString())
                                    .toSorted((a, b) => (a.start_at.getTime() - b.start_at.getTime()) || (b.end_at.getTime() - a.end_at.getTime()))
                                    .map((event, idx, filteredEvents) => {
                                    let cols = 1, colIdx = 0;
                                    const start = event.start_at.getTime();
                                    const end = event.end_at.getTime();
                                    for (let i = 0; i < filteredEvents.length; i++) {
                                        const e_start = filteredEvents[i].start_at.getTime();
                                        const e_end = filteredEvents[i].end_at.getTime();
                                        if ((e_start < start && e_end > start) || (e_start < end && e_end > end)) {
                                            cols++;
                                            if (idx > i) colIdx++;
                                        }
                                    }
                                    return <EventChip key={event.id} event={event} cols={cols} colIdx={colIdx} />
                                })}
                                {eventDraft && <EventDraftChip draft={eventDraft} />}
                                {startOfWeek(today).toDateString() === startOfWeek(focusedDay).toDateString() &&
                                    <div className="cursor-now" style={calcCursorPos()}></div>}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {popover && (
                <NewEventPopover
                    anchor={popover.anchor}
                    initialStart={popover.start}
                    initialDuration={popover.duration}
                    onSave={handlePopoverSave}
                    onClose={() => {setPopover(null); setEventDraft(null)}}
                    setEventDraft={setEventDraft}
                />
            )}
        </div>
    );
}

export default Calendar