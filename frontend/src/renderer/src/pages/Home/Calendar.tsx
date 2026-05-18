import { useEffect, useState } from "react";
import "./calendar.css"

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

    const startOfMonth = (d: Date) =>
        new Date(d.getFullYear(), d.getMonth(), 1);

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
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Calendar