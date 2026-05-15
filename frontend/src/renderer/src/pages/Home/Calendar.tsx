import { useState } from "react";
import "./calendar.css"

function Calendar(): React.JSX.Element {
    const today = new Date();
    const [firstDay] = useState<Date>(() => {
        return new Date(today.getTime() - today.getDay() * 1000 * 60 * 60 * 24)
    });

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const isToday = (d: Date) =>
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear();

    const formatHour = (hour: number) => {
        if (hour === 0) return "";
        const h = (hour % 12) || 12;
        return `${h} ${hour >= 12 ? "PM" : "AM"}`;
    };

    return (
        <div id="week-container">
            <div className="gutter-spacer" />
            <div className="header-container">
                {[...Array(7).keys()].map(idx => {
                    const d = new Date(firstDay);
                    d.setDate(firstDay.getDate() + idx);
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
    );
}

export default Calendar