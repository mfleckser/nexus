import "./monthView.css";
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarEvent, Task } from "@renderer/types";
import AllDayChip from "@renderer/features/calendar/AllDayChip";
import MonthEventItem from "@renderer/features/calendar/MonthEventItem";
import MonthTaskItem from "@renderer/features/calendar/MonthTaskItem";
import { ALL_DAY_ROW_PX } from "@renderer/features/calendar/constants";
import { addDays, calendarDaysBetween } from "@renderer/lib/time";
import { overlapsRange } from "@renderer/lib/eventLayout";
import { isBarItem, layoutMonthWeek } from "@renderer/lib/monthLayout";
import { tasksForEvent } from "@renderer/lib/timeBlocks";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Height (px) of a day cell above its first item slot (date number + padding),
// and kept free below the last. Must match .month-day-cell / .month-week-items
// in monthView.css.
const MONTH_DATE_PX = 28;
const MONTH_BOTTOM_PAD_PX = 2;
// Item slots per cell before the cells are measured.
const DEFAULT_SLOTS = 3;

// A single-day item of a day cell, in start order.
type MonthEntry =
    | { kind: "event"; event: CalendarEvent; at: Date }
    | { kind: "task"; task: Task & { due_at: Date }; at: Date };

const entryTitle = (e: MonthEntry): string => (e.kind === "event" ? e.event.title : e.task.title);

// Events first on a tie: a task due at an event's start reads as part of it.
const byStart = (a: MonthEntry, b: MonthEntry): number =>
    a.at.getTime() - b.at.getTime() ||
    (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1) ||
    entryTitle(a).localeCompare(entryTitle(b));

// Placement of a slot-high box in a week row's day column.
const slotBox = (day: number, row: number): React.CSSProperties => ({
    left: `${(day * 100) / 7}%`,
    width: `calc(${100 / 7}% - 4px)`,
    top: row * ALL_DAY_ROW_PX,
});

type MonthViewProps = {
    // Local midnights of the grid's days, whole weeks from a Sunday.
    cells: Date[];
    // The month shown (0-11); other days are dimmed.
    month: number;
    events: CalendarEvent[];
    // Due tasks in the grid's days.
    dueTasks: (Task & { due_at: Date })[];
    // Time-blocked tasks by event_id (tasksByEventId).
    linkedTasks: Map<string, Task[]>;
    isToday: (d: Date) => boolean;
    // Open `day` in day view (its date or "+N more" was clicked).
    onOpenDay: (day: Date) => void;
};

function MonthView({
    cells,
    month,
    events,
    dueTasks,
    linkedTasks,
    isToday,
    onOpenDay,
}: MonthViewProps): React.JSX.Element {
    const gridRef = useRef<HTMLDivElement>(null);
    const [slots, setSlots] = useState(DEFAULT_SLOTS);

    // Every week row is the same height; fit as many slots as the first
    // holds. Rows resize with the grid, and when the month's week count changes.
    const weekCount = cells.length / 7;
    useLayoutEffect(() => {
        const grid = gridRef.current;
        if (!grid) return;
        const measure = (): void => {
            const row = grid.firstElementChild?.clientHeight ?? 0;
            setSlots(Math.max(1, Math.floor((row - MONTH_DATE_PX - MONTH_BOTTOM_PAD_PX) / ALL_DAY_ROW_PX)));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(grid);
        return () => observer.disconnect();
    }, [weekCount]);

    const weeks = useMemo(() => {
        const gridStart = cells[0];
        const shown = events.filter((e) => overlapsRange(e, gridStart, addDays(cells[cells.length - 1], 1)));
        const bars = shown.filter(isBarItem);
        // Single-day items bucketed by grid day.
        const byDay: MonthEntry[][] = cells.map(() => []);
        const add = (entry: MonthEntry): void => {
            const i = calendarDaysBetween(gridStart, entry.at);
            if (i >= 0 && i < cells.length) byDay[i].push(entry);
        };
        for (const event of shown) if (!isBarItem(event)) add({ kind: "event", event, at: event.start_at });
        for (const task of dueTasks) add({ kind: "task", task, at: task.due_at });
        return Array.from({ length: weekCount }, (_, w) => {
            const days = cells.slice(7 * w, 7 * w + 7);
            const dayItems = byDay.slice(7 * w, 7 * w + 7).map((items) => items.sort(byStart));
            return { start: days[0], days, layout: layoutMonthWeek(bars, dayItems, days[0], slots) };
        });
    }, [cells, weekCount, events, dueTasks, slots]);

    return (
        <div id="month-container">
            <div className="month-header">
                {DAY_NAMES.map((name) => (
                    <div key={name} className="day-header">
                        <span className="day-name">{name}</span>
                    </div>
                ))}
            </div>
            <div className="month-grid" ref={gridRef} style={{ ["--all-day-row" as string]: `${ALL_DAY_ROW_PX}px` }}>
                {weeks.map(({ start, days, layout }) => (
                    <div key={start.getTime()} className="month-week">
                        {days.map((d) => (
                            <div
                                key={d.getTime()}
                                className={`month-day-cell${isToday(d) ? " today-cell" : ""}${d.getMonth() !== month ? " out-of-month" : ""}`}
                            >
                                <button
                                    type="button"
                                    className="date-num"
                                    aria-label={`Open ${d.toDateString()}`}
                                    onClick={() => onOpenDay(d)}
                                >
                                    {d.getDate()}
                                </button>
                            </div>
                        ))}
                        <div className="month-week-items">
                            {layout.bars.map((bar) => (
                                <AllDayChip
                                    key={bar.item.id}
                                    bar={bar}
                                    rangeStart={start}
                                    dayCount={7}
                                    linkedTasks={tasksForEvent(linkedTasks, bar.item)}
                                />
                            ))}
                            {layout.days.map((day, i) => (
                                <Fragment key={i}>
                                    {day.items.map(({ item, row }) =>
                                        item.kind === "event" ? (
                                            <MonthEventItem
                                                key={item.event.id}
                                                event={item.event}
                                                linkedTasks={tasksForEvent(linkedTasks, item.event)}
                                                style={slotBox(i, row)}
                                            />
                                        ) : (
                                            <MonthTaskItem
                                                key={item.task.id}
                                                task={item.task}
                                                style={slotBox(i, row)}
                                            />
                                        ),
                                    )}
                                    {day.more > 0 && (
                                        <button
                                            type="button"
                                            className="month-more"
                                            style={slotBox(i, day.moreRow)}
                                            onClick={() => onOpenDay(days[i])}
                                        >
                                            +{day.more} more
                                        </button>
                                    )}
                                </Fragment>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default MonthView;
