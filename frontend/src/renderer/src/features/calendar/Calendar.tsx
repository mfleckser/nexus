import { Fragment, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import "./calendar.css";
import { useEvents } from "@renderer/features/calendar/useEvents";
import EventChip, { EventDraftPreview } from "./EventChip";
import NewEventPopover from "@renderer/features/calendar/NewEventPopover";
import TaskPin from "@renderer/features/calendar/TaskPin";
import { useTasks } from "@renderer/features/tasks/useTasks";
import { useProjects } from "@renderer/features/projects/useProjects";
import useNow from "@renderer/hooks/useNow";
import useReportError from "@renderer/hooks/useReportError";
import { PopoverAnchor } from "@renderer/hooks/usePopoverPosition";
import { DateRange, NewEventDraft, Task } from "@renderer/types";
import {
    addDays,
    atMinutes,
    calendarDaysBetween,
    minutesIntoDay,
    MINUTES_PER_DAY,
    startOfDay,
    startOfWeek,
} from "@renderer/lib/time";
import { layoutDays, overlapsRange } from "@renderer/lib/eventLayout";
import {
    DEFAULT_EVENT_MINUTES,
    DRAG_THRESHOLD,
    POPOVER_GAP,
    PX_PER_MIN,
    SLOT_MINUTES,
    TASK_PIN_HEIGHT,
} from "@renderer/features/calendar/constants";

const BUFFER_DAYS = 7;
const SLOTS_PER_DAY = MINUTES_PER_DAY / SLOT_MINUTES;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type ViewType = "DAY" | "WEEK" | "MONTH";

// In-progress drag-to-create, in grid slots of SLOT_MINUTES.
type CreateDrag = {
    dayIndex: number;
    anchorSlot: number;
    pointerSlot: number;
    // Pointer travel past DRAG_THRESHOLD; a plain click creates a default-length event.
    moved: boolean;
    pressX: number;
    pressY: number;
};

// The slot range a drag covers, inclusive of both ends, in either direction.
function dragMinutes(drag: CreateDrag): { startMin: number; duration: number } {
    if (!drag.moved) return { startMin: drag.anchorSlot * SLOT_MINUTES, duration: DEFAULT_EVENT_MINUTES };
    const first = Math.min(drag.anchorSlot, drag.pointerSlot);
    const last = Math.max(drag.anchorSlot, drag.pointerSlot);
    return { startMin: first * SLOT_MINUTES, duration: (last - first + 1) * SLOT_MINUTES };
}

// Keys belong to whatever has focus, or to an open dialog/popover.
function shortcutsBlocked(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return true;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName))) return true;
    return document.querySelector('[role="dialog"]') !== null;
}

const formatHour = (hour: number) => {
    if (hour === 0) return "";
    const h = hour % 12 || 12;
    return `${h} ${hour >= 12 ? "PM" : "AM"}`;
};

function Calendar(): React.JSX.Element {
    const now = useNow();
    // Local midnight; for week view, any day of the shown week.
    const [focusedDay, setFocusedDay] = useState<Date>(() => startOfDay(new Date()));
    const [viewType, setViewType] = useState<ViewType>("WEEK");
    // Day columns in the time grid.
    const dayCount = viewType === "DAY" ? 1 : 7;
    const { events, addEvent, setRange } = useEvents();
    const { tasks } = useTasks();
    const { projects } = useProjects();
    const reportError = useReportError();
    const [popover, setPopover] = useState<{ anchor: PopoverAnchor; start: Date; duration?: number } | null>(null);
    // Live values of the new-event popover, previewed on the grid.
    const [eventDraft, setEventDraft] = useState<NewEventDraft | null>(null);
    const [createDrag, setCreateDrag] = useState<CreateDrag | null>(null);
    const overlayRef = useRef<HTMLDivElement>(null);

    const year = focusedDay.getFullYear();
    const month = focusedDay.getMonth();

    const monthGrid = useMemo(() => {
        const firstOfMonth = new Date(year, month, 1);
        const lastOfMonth = new Date(year, month + 1, 0);
        const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay());
        const gridEnd = addDays(lastOfMonth, 6 - lastOfMonth.getDay());
        const cells: Date[] = [];
        for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) cells.push(d);
        return { gridStart, gridEnd, cells };
    }, [year, month]);

    const monthCells = viewType === "MONTH" ? monthGrid.cells : [];

    // The window the user can actually see.
    const visible = useMemo<DateRange>(() => {
        if (viewType === "MONTH") {
            return { start: monthGrid.gridStart, end: addDays(monthGrid.gridEnd, 1) };
        }
        const start = viewType === "DAY" ? focusedDay : startOfWeek(focusedDay);
        return { start, end: addDays(start, viewType === "DAY" ? 1 : 7) };
    }, [viewType, focusedDay, monthGrid]);
    const rangeStart = visible.start;
    const gridDays = useMemo(
        () => Array.from({ length: dayCount }, (_, i) => addDays(rangeStart, i)),
        [rangeStart, dayCount],
    );

    // What we ask the server for: visible ± one buffer period, so the next
    // nav step usually renders from memory while the refetch confirms it.
    // setRange ignores a value-equal range, so recomputing this is harmless.
    const fetchWindow = useMemo<DateRange>(
        () => ({
            start: addDays(visible.start, -BUFFER_DAYS),
            end: addDays(visible.end, BUFFER_DAYS),
        }),
        [visible],
    );

    useEffect(() => {
        setRange(fetchWindow);
    }, [fetchWindow, setRange]);

    // Per-day slices of every visible event, laid out in columns.
    const segments = useMemo(
        () =>
            viewType === "MONTH"
                ? []
                : layoutDays(
                      events.filter((e) => overlapsRange(e, visible.start, visible.end)),
                      visible.start,
                      dayCount,
                  ),
        [events, visible, viewType, dayCount],
    );

    // Due tasks in the visible days, with each pin's top pushed below any
    // earlier pin on the same day it would overlap. Completed/cancelled stay
    // visible; tasks of projects hidden from the main view don't.
    const taskPins = useMemo(() => {
        const hiddenProjectIds = new Set(projects.filter((p) => !p.show_tasks_in_main_view).map((p) => p.id));
        const lastBottom = Array(dayCount).fill(-Infinity);
        return tasks
            .filter(
                (t): t is Task & { due_at: Date } =>
                    t.due_at !== null &&
                    t.due_at.getTime() >= visible.start.getTime() &&
                    t.due_at.getTime() < visible.end.getTime() &&
                    (t.project_id === null || !hiddenProjectIds.has(t.project_id)),
            )
            .toSorted((a, b) => a.due_at.getTime() - b.due_at.getTime() || a.title.localeCompare(b.title))
            .map((task) => {
                const day = calendarDaysBetween(visible.start, task.due_at);
                const dueTop = Math.min(
                    minutesIntoDay(task.due_at) * PX_PER_MIN,
                    MINUTES_PER_DAY * PX_PER_MIN - TASK_PIN_HEIGHT,
                );
                const top = Math.max(dueTop, lastBottom[day] + 1);
                lastBottom[day] = top + TASK_PIN_HEIGHT;
                return { task, top, day };
            });
    }, [tasks, projects, visible, dayCount]);

    const goPrev = () => {
        setFocusedDay((prev) =>
            viewType === "MONTH" ? new Date(prev.getFullYear(), prev.getMonth() - 1, 1) : addDays(prev, -dayCount),
        );
    };

    const goNext = () => {
        setFocusedDay((prev) =>
            viewType === "MONTH" ? new Date(prev.getFullYear(), prev.getMonth() + 1, 1) : addDays(prev, dayCount),
        );
    };

    // Reads the clock rather than `now`, which can be up to a minute stale.
    const goToday = () => {
        setFocusedDay(startOfDay(new Date()));
    };

    const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
        if (shortcutsBlocked(e)) return;
        if (e.key === "ArrowLeft") goPrev();
        else if (e.key === "ArrowRight") goNext();
        else if (e.key === "d") setViewType("DAY");
        else if (e.key === "w") setViewType("WEEK");
        else if (e.key === "m") setViewType("MONTH");
        else if (e.key === "t") goToday();
    });

    useEffect(() => {
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    const openNewEventAt = (start: Date, anchor: PopoverAnchor, duration: number = DEFAULT_EVENT_MINUTES) => {
        setPopover({ anchor, start, duration });
    };

    // Grid slot under the pointer's y, clamped to the day.
    const slotAt = (clientY: number): number => {
        const rect = overlayRef.current?.getBoundingClientRect();
        if (!rect) return 0;
        return Math.min(SLOTS_PER_DAY - 1, Math.max(0, Math.floor((clientY - rect.top) / PX_PER_MIN / SLOT_MINUTES)));
    };

    const handleSlotMouseDown = (day: number) => (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault(); // no text selection while dragging
        const slot = slotAt(e.clientY);
        setCreateDrag({
            dayIndex: day,
            anchorSlot: slot,
            pointerSlot: slot,
            moved: false,
            pressX: e.clientX,
            pressY: e.clientY,
        });
    };

    const onCreateDragMove = useEffectEvent((e: MouseEvent) => {
        setCreateDrag(
            (prev) =>
                prev && {
                    ...prev,
                    pointerSlot: slotAt(e.clientY),
                    moved: prev.moved || Math.hypot(e.clientX - prev.pressX, e.clientY - prev.pressY) > DRAG_THRESHOLD,
                },
        );
    });

    // Window-level, so releasing anywhere (over a chip, outside the grid or
    // the window) finishes the drag.
    const onCreateDragEnd = useEffectEvent(() => {
        const drag = createDrag;
        setCreateDrag(null);
        const rect = overlayRef.current?.getBoundingClientRect();
        if (!drag || !rect) return;
        const { startMin, duration } = dragMinutes(drag);
        const colWidth = rect.width / dayCount;
        openNewEventAt(
            atMinutes(addDays(rangeStart, drag.dayIndex), startMin),
            {
                x: rect.left + (drag.dayIndex + 1) * colWidth + POPOVER_GAP,
                y: rect.top + startMin * PX_PER_MIN,
                flipX: rect.left + drag.dayIndex * colWidth - POPOVER_GAP,
            },
            duration,
        );
    });

    const dragActive = createDrag !== null;
    useEffect(() => {
        if (!dragActive) return;
        window.addEventListener("mousemove", onCreateDragMove);
        window.addEventListener("mouseup", onCreateDragEnd);
        return () => {
            window.removeEventListener("mousemove", onCreateDragMove);
            window.removeEventListener("mouseup", onCreateDragEnd);
        };
    }, [dragActive]);

    const handleNewEventButton = (e: React.MouseEvent<HTMLButtonElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const start = new Date();
        start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
        openNewEventAt(start, { x: rect.left, y: rect.bottom + POPOVER_GAP });
    };

    const closePopover = () => {
        setPopover(null);
        setEventDraft(null);
    };

    const handlePopoverSave = (draft: NewEventDraft) => {
        addEvent(draft).catch((err) => reportError("Couldn't create event", err));
        closePopover();
    };

    const isToday = (d: Date) =>
        d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();

    // While dragging, the preview follows the drag; afterwards, the popover's form.
    let previewDraft = eventDraft;
    if (createDrag) {
        const { startMin, duration } = dragMinutes(createDrag);
        previewDraft = {
            title: "",
            description: "",
            start_at: atMinutes(addDays(rangeStart, createDrag.dayIndex), startMin),
            duration,
            category: "",
        };
    }

    const nowDayIndex = calendarDaysBetween(rangeStart, now);
    const nowLineStyle: React.CSSProperties = {
        left: `${(nowDayIndex * 100) / dayCount}%`,
        top: minutesIntoDay(now) * PX_PER_MIN,
    };

    return (
        <div id="calendar-container">
            <div id="calendar-header">
                <div className="header-left">
                    <button className="new-event-button" onClick={handleNewEventButton}>
                        + New Event
                    </button>
                    <button className="today-button" onClick={goToday}>
                        Today
                    </button>
                    <div className="nav-group">
                        <button className="nav-button" aria-label="Previous" onClick={goPrev}>
                            ‹
                        </button>
                        <button className="nav-button" aria-label="Next" onClick={goNext}>
                            ›
                        </button>
                    </div>
                    <span className="month-year-label">
                        {MONTH_NAMES[month]} {year}
                    </span>
                </div>
                <div className="select-wrapper">
                    <select
                        className="view-select"
                        aria-label="View"
                        value={viewType}
                        onChange={(e) => setViewType(e.target.value as ViewType)}
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
                        {DAY_NAMES.map((name) => (
                            <div key={name} className="day-header">
                                <span className="day-name">{name}</span>
                            </div>
                        ))}
                    </div>
                    <div className="month-grid">
                        {monthCells.map((d) => {
                            const outOfMonth = d.getMonth() !== month;
                            return (
                                <div
                                    key={d.getTime()}
                                    className={`month-day-cell${isToday(d) ? " today-cell" : ""}${outOfMonth ? " out-of-month" : ""}`}
                                >
                                    <span className="date-num">{d.getDate()}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <div id="week-container" style={{ ["--day-count" as string]: dayCount }}>
                    <div className="gutter-spacer" />
                    <div className="header-container">
                        {gridDays.map((d) => (
                            <div key={d.getTime()} className={`day-header${isToday(d) ? " today-header" : ""}`}>
                                <span className="day-name">{DAY_NAMES[d.getDay()]}</span>
                                <span className="date-num">{d.getDate()}</span>
                            </div>
                        ))}
                    </div>
                    <div className="gutter-spacer all-day-gutter" />
                    <div className="all-day-container">
                        {gridDays.map((d) => (
                            <div key={d.getTime()} className="all-day-cell" />
                        ))}
                    </div>
                    <div className="day-events-scroll">
                        <div className="day-events">
                            {[...Array(24).keys()].map((hour) => (
                                <Fragment key={hour}>
                                    <div className="hour-label">{formatHour(hour)}</div>
                                    {[...Array(dayCount).keys()].map((day) => (
                                        <div key={day} className="hour-block" onMouseDown={handleSlotMouseDown(day)} />
                                    ))}
                                </Fragment>
                            ))}
                            <div className="events-overlay" ref={overlayRef}>
                                {segments.map((segment) => (
                                    <EventChip
                                        key={`${segment.item.id}:${segment.dayIndex}`}
                                        segment={segment}
                                        dayCount={dayCount}
                                    />
                                ))}
                                {taskPins.map(({ task, top, day }) => (
                                    <TaskPin key={task.id} task={task} top={top} dayIdx={day} dayCount={dayCount} />
                                ))}
                                {previewDraft && (
                                    <EventDraftPreview
                                        draft={previewDraft}
                                        rangeStart={rangeStart}
                                        dayCount={dayCount}
                                    />
                                )}
                                {nowDayIndex >= 0 && nowDayIndex < dayCount && (
                                    <div className="cursor-now" style={nowLineStyle}></div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {popover && (
                <NewEventPopover
                    key={`${popover.start.getTime()}:${popover.duration}`}
                    anchor={popover.anchor}
                    initialStart={popover.start}
                    initialDuration={popover.duration}
                    onSave={handlePopoverSave}
                    onClose={closePopover}
                    onDraftChange={setEventDraft}
                />
            )}
        </div>
    );
}

export default Calendar;
