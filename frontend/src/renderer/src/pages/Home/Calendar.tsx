import { useEffect, useState } from "react";
import "./calendar.css"

type Event = {
    id: string;
    title: string;
    start_at: Date;
    end_at: Date;
};

const PX_PER_HOUR = 48;
const PX_PER_MIN = PX_PER_HOUR / 60;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

const at = (dayOffset: number, h: number, m: number = 0): Date => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d;
};

// Dummy events anchored to today. start_at/end_at assumed same day (no multi-day).
const DUMMY_EVENTS: Event[] = [
    { id: "e1", title: "Standup", start_at: at(0, 9, 0), end_at: at(0, 10, 0) },
    { id: "e2", title: "Deep work block", start_at: at(1, 13, 0), end_at: at(1, 16, 30) },
    { id: "e3", title: "Design review", start_at: at(2, 10, 0), end_at: at(2, 11, 0) },
    { id: "e4", title: "Coffee w/ Sam", start_at: at(2, 10, 30), end_at: at(2, 11, 30) },
    { id: "e5", title: "Triage", start_at: at(3, 14, 0), end_at: at(3, 15, 0) },
    { id: "e6", title: "1:1 Alex", start_at: at(3, 14, 15), end_at: at(3, 15, 15) },
    { id: "e7", title: "Planning", start_at: at(3, 14, 30), end_at: at(3, 16, 0) },
    { id: "e8", title: "Errand window", start_at: at(-1, 9, 15), end_at: at(-1, 10, 45) },
];

const fmtTime = (d: Date) => {
    const h = d.getHours();
    const m = d.getMinutes();
    const hh = (h % 12) || 12;
    const mm = m.toString().padStart(2, "0");
    return `${hh}:${mm} ${h >= 12 ? "PM" : "AM"}`;
};

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
                                {buildEventLayout(DUMMY_EVENTS, startOfWeek(focusedDay)).map((dayEvents, dayIdx) => (
                                    <div key={`col-${dayIdx}`} className="day-event-column">
                                        {dayEvents.map(({ event, col, colCount }) => {
                                            const startMin = event.start_at.getHours() * 60 + event.start_at.getMinutes();
                                            const durMin = (event.end_at.getTime() - event.start_at.getTime()) / 60000;
                                            return (
                                                <div
                                                    key={event.id}
                                                    className="event-chip"
                                                    style={{
                                                        top: startMin * PX_PER_MIN,
                                                        height: durMin * PX_PER_MIN,
                                                        left: `${(col / colCount) * 100}%`,
                                                        width: `${(1 / colCount) * 100}%`,
                                                    }}
                                                >
                                                    <div className="event-chip-title">{event.title}</div>
                                                    <div className="event-chip-time">{fmtTime(event.start_at)} – {fmtTime(event.end_at)}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Calendar