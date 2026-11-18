import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import "./newEventPopover.css";
import categoryData from "./categories.json";
import { NewEventDraft } from "@renderer/types";
import { addDays, calendarDaysBetween, parseDateTimeInputs, toDateInput, toTimeInput } from "@renderer/lib/time";
import useDismiss from "@renderer/hooks/useDismiss";
import usePopoverPosition, { PopoverAnchor } from "@renderer/hooks/usePopoverPosition";
import {
    Recurrence,
    RecurrenceFreq,
    RepeatPreset,
    Weekday,
    WEEKDAYS,
    MAX_COUNT,
    buildRrule,
    parseRrule,
    presetRecurrence,
    matchPreset,
    presetLabel,
    describeRecurrence,
    weekdayOf,
    weekdayShort,
    firstOccurrenceDay,
    maxUntilDate,
} from "@renderer/lib/rrule";

const DURATION_PRESETS = [30, 45, 60, 90, 120];
const REPEAT_PRESETS: RepeatPreset[] = ["none", "daily", "weekdays", "weekly", "monthly", "yearly"];
const FREQ_UNITS: Record<RecurrenceFreq, string> = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" };

// Length of a new timed event, and of an all-day event switched to timed.
const DEFAULT_DURATION = 60;
// Start time given to an all-day event switched to timed.
const DEFAULT_START_TIME = "09:00";

const parseDateInput = (s: string): Date | null => parseDateTimeInputs(s, "00:00");
const addMinutes = (d: Date, minutes: number): Date => new Date(d.getTime() + minutes * 60000);
const minutesBetween = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / 60000);

// Last calendar day [start, end) reaches into: an end at midnight doesn't count.
const lastDayOf = (start: Date, end: Date): Date => {
    const last = new Date(Math.max(start.getTime(), end.getTime() - 1));
    return new Date(last.getFullYear(), last.getMonth(), last.getDate());
};

const formatDuration = (mins: number): string =>
    mins < 60 ? `${mins}m` : mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60)}h${mins % 60}`;

type RepeatMode = RepeatPreset | "custom";

// Editable (string-valued) mirror of a Recurrence for the custom sub-form.
type CustomRepeatForm = {
    freq: RecurrenceFreq;
    interval: string;
    byday: Weekday[];
    endType: "never" | "until" | "count";
    until: string; // YYYY-MM-DD
    count: string;
};

function customFormFrom(rec: Recurrence, start: Date): CustomRepeatForm {
    return {
        freq: rec.freq,
        interval: String(rec.interval),
        byday: rec.byday.length ? rec.byday : [weekdayOf(start)],
        endType: rec.end.type,
        until: toDateInput(
            rec.end.type === "until"
                ? rec.end.date
                : new Date(start.getFullYear(), start.getMonth() + 1, start.getDate()),
        ),
        count: rec.end.type === "count" ? String(rec.end.n) : "10",
    };
}

// null = the form doesn't describe a valid rule yet (Save is disabled).
function customFormToRecurrence(form: CustomRepeatForm, start: Date): Recurrence | null {
    const interval = Number(form.interval);
    if (!Number.isInteger(interval) || interval < 1) return null;
    if (form.freq === "WEEKLY" && !form.byday.length) return null;
    const rec: Recurrence = {
        freq: form.freq,
        interval,
        byday: form.freq === "WEEKLY" ? form.byday : [],
        end: { type: "never" },
    };
    if (form.endType === "until") {
        // Backend 400s on UNTIL > 50y and on rules with no occurrences at all.
        const date = parseDateInput(form.until);
        const first = firstOccurrenceDay(rec, start);
        if (!date || !first || date < first || date > maxUntilDate(start)) return null;
        rec.end = { type: "until", date };
    } else if (form.endType === "count") {
        const n = Number(form.count);
        if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) return null;
        rec.end = { type: "count", n };
    }
    return rec;
}

const defaultCustomForm = (start: Date): CustomRepeatForm => customFormFrom(presetRecurrence("weekly", start)!, start);

function initialRepeatState(
    rrule: string | null | undefined,
    start: Date,
): { mode: RepeatMode; custom: CustomRepeatForm; unknown: boolean } {
    if (!rrule) return { mode: "none", custom: defaultCustomForm(start), unknown: false };
    const rec = parseRrule(rrule, start);
    if (!rec) return { mode: "custom", custom: defaultCustomForm(start), unknown: true };
    return { mode: matchPreset(rec, start) ?? "custom", custom: customFormFrom(rec, start), unknown: false };
}

export type NewEventPopoverProps = {
    anchor: PopoverAnchor;
    // For an all-day event: local midnight of its first day, and of the day
    // after its last. Defaults to an hour after the start.
    initialStart: Date;
    initialEnd?: Date;
    initialAllDay?: boolean;
    initialTitle?: string;
    initialDescription?: string;
    initialCategory?: string;
    // Existing event's RRULE body (edit mode). Emitted unchanged unless the
    // user touches the Repeat controls.
    initialRrule?: string | null;
    onSave: (draft: NewEventDraft) => void;
    onClose: () => void;
    onDelete?: () => void;
    // Extra rows below the description (e.g. the event's linked tasks); they
    // act on their own, outside the form's Save.
    extraFields?: ReactNode;
    // Live form values, for a preview on the grid; not called while the
    // date/time/duration fields are invalid.
    onDraftChange?: (draft: NewEventDraft) => void;
};

function NewEventPopover({
    anchor,
    initialStart,
    initialEnd,
    initialAllDay = false,
    initialTitle = "",
    initialDescription = "",
    initialCategory = "",
    initialRrule,
    onSave,
    onClose,
    onDelete,
    extraFields,
    onDraftChange,
}: NewEventPopoverProps): React.JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);
    const ids = useId();

    const [title, setTitle] = useState(initialTitle);
    const [description, setDescription] = useState(initialDescription);
    const [category, setCategory] = useState(initialCategory);
    const [allDay, setAllDay] = useState(initialAllDay);
    // Start date (the first day, for all-day) and time (kept, but unused, while all-day).
    const [dateStr, setDateStr] = useState(toDateInput(initialStart));
    const [timeStr, setTimeStr] = useState(initialAllDay ? DEFAULT_START_TIME : toTimeInput(initialStart));
    // Timed end, and the timed length it follows when the start moves (the last
    // valid one while the end is mid-edit or before the start).
    const [timedInit] = useState(() => {
        if (!initialAllDay) {
            const end = initialEnd ?? addMinutes(initialStart, DEFAULT_DURATION);
            return { end, duration: minutesBetween(initialStart, end) };
        }
        const start = parseDateTimeInputs(toDateInput(initialStart), DEFAULT_START_TIME) ?? initialStart;
        return { end: addMinutes(start, DEFAULT_DURATION), duration: DEFAULT_DURATION };
    });
    const [duration, setDuration] = useState(timedInit.duration);
    const [endDateStr, setEndDateStr] = useState(toDateInput(timedInit.end));
    const [endTimeStr, setEndTimeStr] = useState(toTimeInput(timedInit.end));
    // All-day: last day (inclusive).
    const [lastDateStr, setLastDateStr] = useState(() =>
        toDateInput(initialAllDay && initialEnd ? addDays(initialEnd, -1) : initialStart),
    );
    const { left, top } = usePopoverPosition(rootRef, anchor);

    const [initialRepeat] = useState(() => initialRepeatState(initialRrule, initialStart));
    const [repeatMode, setRepeatMode] = useState<RepeatMode>(initialRepeat.mode);
    const [customRepeat, setCustomRepeat] = useState<CustomRepeatForm>(initialRepeat.custom);
    const [repeatTouched, setRepeatTouched] = useState(false);
    const showUnknownRule = initialRepeat.unknown && !repeatTouched;

    // null while the date/time inputs are empty or mid-edit; endAt also while
    // it isn't after the start (on or after the first day, for all-day).
    const startAt = allDay ? parseDateInput(dateStr) : parseDateTimeInputs(dateStr, timeStr);
    const endAt = ((): Date | null => {
        if (!startAt) return null;
        if (allDay) {
            const last = parseDateInput(lastDateStr);
            return last && last >= startAt ? addDays(last, 1) : null;
        }
        const end = parseDateTimeInputs(endDateStr, endTimeStr);
        return end && end > startAt ? end : null;
    })();
    const startMs = startAt?.getTime() ?? null;
    const endMs = endAt?.getTime() ?? null;
    // Labels/presets follow the chosen start; fall back while the date input is mid-edit.
    const repeatStart = startAt ?? initialStart;
    const customRecurrence = repeatMode === "custom" ? customFormToRecurrence(customRepeat, repeatStart) : null;
    const rrule = computeRrule();
    const canSave = !!title.trim() && startAt !== null && endAt !== null && rrule !== undefined;

    useEffect(() => {
        titleRef.current?.focus();
    }, []);

    useEffect(() => {
        if (startMs === null || endMs === null || !onDraftChange) return;
        onDraftChange({
            title,
            description,
            start_at: new Date(startMs),
            end_at: new Date(endMs),
            all_day: allDay,
            category,
            rrule: rrule ?? null,
        });
    }, [title, description, startMs, endMs, allDay, category, rrule, onDraftChange]);

    useDismiss(rootRef, onClose);

    // undefined = custom form currently invalid.
    function computeRrule(): string | null | undefined {
        if (initialRrule && !repeatTouched) return initialRrule;
        if (repeatMode === "custom") return customRecurrence ? buildRrule(customRecurrence) : undefined;
        const rec = presetRecurrence(repeatMode, repeatStart);
        return rec ? buildRrule(rec) : null;
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!canSave || startAt === null || endAt === null || rrule === undefined) return;
        onSave({
            title: title.trim(),
            description: description.trim(),
            start_at: startAt,
            end_at: endAt,
            all_day: allDay,
            category,
            rrule,
        });
    }

    // The timed end follows the start, keeping the event's length.
    function setTimedEnd(start: Date | null, minutes: number) {
        if (!start) return;
        const end = addMinutes(start, minutes);
        setEndDateStr(toDateInput(end));
        setEndTimeStr(toTimeInput(end));
    }

    function onStartDateChange(v: string) {
        if (allDay) {
            // Move the last day along, keeping the number of days.
            const [oldFirst, oldLast, first] = [
                parseDateInput(dateStr),
                parseDateInput(lastDateStr),
                parseDateInput(v),
            ];
            if (oldFirst && oldLast && first && oldLast >= oldFirst) {
                setLastDateStr(toDateInput(addDays(first, calendarDaysBetween(oldFirst, oldLast))));
            }
        } else {
            setTimedEnd(parseDateTimeInputs(v, timeStr), duration);
        }
        setDateStr(v);
    }

    function onStartTimeChange(v: string) {
        setTimeStr(v);
        setTimedEnd(parseDateTimeInputs(dateStr, v), duration);
    }

    function onEndChange(date: string, time: string) {
        setEndDateStr(date);
        setEndTimeStr(time);
        const start = parseDateTimeInputs(dateStr, timeStr);
        const end = parseDateTimeInputs(date, time);
        if (start && end && end > start) setDuration(minutesBetween(start, end));
    }

    function selectPreset(mins: number) {
        setDuration(mins);
        setTimedEnd(startAt, mins);
    }

    function toggleAllDay() {
        if (!allDay) {
            // Keep the days the timed event touches.
            const start = parseDateTimeInputs(dateStr, timeStr);
            const end = parseDateTimeInputs(endDateStr, endTimeStr);
            if (start && end && end > start) setLastDateStr(toDateInput(lastDayOf(start, end)));
            else setLastDateStr(dateStr);
        } else {
            setTimedEnd(parseDateTimeInputs(dateStr, timeStr), duration);
        }
        setAllDay(!allDay);
    }

    function onRepeatModeChange(mode: RepeatMode) {
        setRepeatTouched(true);
        if (mode === "custom" && repeatMode !== "custom") {
            // Seed the custom form from what was selected, so "Custom" starts from it.
            const rec = presetRecurrence(repeatMode, repeatStart);
            setCustomRepeat(rec ? customFormFrom(rec, repeatStart) : defaultCustomForm(repeatStart));
        }
        setRepeatMode(mode);
    }

    function updateCustomRepeat(patch: Partial<CustomRepeatForm>) {
        setRepeatTouched(true);
        setCustomRepeat((prev) => ({ ...prev, ...patch }));
    }

    function toggleWeekday(day: Weekday) {
        const has = customRepeat.byday.includes(day);
        if (has && customRepeat.byday.length === 1) return; // weekly needs at least one day
        updateCustomRepeat({
            byday: has ? customRepeat.byday.filter((d) => d !== day) : [...customRepeat.byday, day],
        });
    }

    const style: React.CSSProperties = {
        left,
        top,
    };

    return (
        <div
            ref={rootRef}
            className="new-event-popover themed-scroll"
            style={style}
            role="dialog"
            aria-label={onDelete ? "Edit event" : "New event"}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <form onSubmit={handleSubmit}>
                <input
                    ref={titleRef}
                    className="nep-title"
                    type="text"
                    placeholder="Add title"
                    aria-label="Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                />

                <textarea
                    className="nep-description"
                    placeholder="Description (optional)"
                    aria-label="Description"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                />

                {extraFields}

                <div className="nep-field-row">
                    <span className="nep-label" id={`${ids}-category`}>
                        Category
                    </span>
                    <div className="nep-category-container" role="group" aria-labelledby={`${ids}-category`}>
                        {categoryData
                            .filter((cat) => cat.name !== "none")
                            .map((cat) => (
                                <button
                                    key={cat.name}
                                    type="button"
                                    className={`nep-category-option${category === cat.name ? " nep-category-option-selected" : ""}`}
                                    aria-pressed={category === cat.name}
                                    onClick={() => setCategory(category === cat.name ? "" : cat.name)}
                                >
                                    {cat.name}
                                </button>
                            ))}
                    </div>
                </div>

                <div className="nep-field-row">
                    <div className="nep-label-row">
                        <label className="nep-label" htmlFor={`${ids}-date`}>
                            Start
                        </label>
                        <button
                            type="button"
                            className={`nep-chip nep-chip-small${allDay ? " nep-chip-active" : ""}`}
                            aria-pressed={allDay}
                            onClick={toggleAllDay}
                        >
                            All day
                        </button>
                    </div>
                    <div className="nep-datetime">
                        <input
                            id={`${ids}-date`}
                            className="nep-input"
                            type="date"
                            value={dateStr}
                            onChange={(e) => onStartDateChange(e.target.value)}
                        />
                        {!allDay && (
                            <input
                                className="nep-input"
                                type="time"
                                aria-label="Start time"
                                value={timeStr}
                                onChange={(e) => onStartTimeChange(e.target.value)}
                            />
                        )}
                    </div>
                </div>

                <div className="nep-field-row">
                    <label className="nep-label" htmlFor={`${ids}-end-date`}>
                        End
                    </label>
                    <div className="nep-datetime">
                        {allDay ? (
                            <input
                                id={`${ids}-end-date`}
                                className={`nep-input${endAt ? "" : " nep-input-invalid"}`}
                                type="date"
                                min={dateStr}
                                value={lastDateStr}
                                onChange={(e) => setLastDateStr(e.target.value)}
                            />
                        ) : (
                            <>
                                <input
                                    id={`${ids}-end-date`}
                                    className={`nep-input${endAt ? "" : " nep-input-invalid"}`}
                                    type="date"
                                    min={dateStr}
                                    value={endDateStr}
                                    onChange={(e) => onEndChange(e.target.value, endTimeStr)}
                                />
                                <input
                                    className={`nep-input${endAt ? "" : " nep-input-invalid"}`}
                                    type="time"
                                    aria-label="End time"
                                    value={endTimeStr}
                                    onChange={(e) => onEndChange(endDateStr, e.target.value)}
                                />
                            </>
                        )}
                    </div>
                    {!allDay && (
                        <div className="nep-chips" role="group" aria-label="Duration presets">
                            {DURATION_PRESETS.map((mins) => {
                                const active =
                                    endAt !== null && startAt !== null && minutesBetween(startAt, endAt) === mins;
                                return (
                                    <button
                                        key={mins}
                                        type="button"
                                        className={`nep-chip${active ? " nep-chip-active" : ""}`}
                                        aria-pressed={active}
                                        onClick={() => selectPreset(mins)}
                                    >
                                        {formatDuration(mins)}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="nep-field-row">
                    <label className="nep-label" htmlFor={`${ids}-repeat`}>
                        Repeat
                    </label>
                    <div className="nep-select-wrapper">
                        <select
                            id={`${ids}-repeat`}
                            className="nep-select"
                            value={repeatMode}
                            onChange={(e) => onRepeatModeChange(e.target.value as RepeatMode)}
                        >
                            {REPEAT_PRESETS.map((p) => (
                                <option key={p} value={p}>
                                    {presetLabel(p, repeatStart)}
                                </option>
                            ))}
                            <option value="custom">
                                {repeatMode !== "custom"
                                    ? "Custom…"
                                    : showUnknownRule
                                      ? "Custom rule"
                                      : customRecurrence
                                        ? describeRecurrence(customRecurrence, repeatStart)
                                        : "Custom…"}
                            </option>
                        </select>
                    </div>
                    {repeatMode === "custom" &&
                        (showUnknownRule ? (
                            <div className="nep-repeat-custom">
                                <p className="nep-repeat-note">
                                    This event uses a rule the picker can&apos;t edit. It&apos;s kept as-is unless you
                                    change it.
                                </p>
                                <code className="nep-repeat-rule">{initialRrule}</code>
                                <button
                                    type="button"
                                    className="nep-chip nep-repeat-edit"
                                    onClick={() => setRepeatTouched(true)}
                                >
                                    Replace rule
                                </button>
                            </div>
                        ) : (
                            <div className="nep-repeat-custom">
                                <div className="nep-repeat-line">
                                    <span className="nep-repeat-text">Every</span>
                                    <input
                                        className="nep-input nep-input-narrow"
                                        type="number"
                                        min={1}
                                        aria-label="Repeat interval"
                                        value={customRepeat.interval}
                                        onChange={(e) => updateCustomRepeat({ interval: e.target.value })}
                                    />
                                    <div className="nep-select-wrapper nep-select-grow">
                                        <select
                                            className="nep-select"
                                            aria-label="Repeat unit"
                                            value={customRepeat.freq}
                                            onChange={(e) =>
                                                updateCustomRepeat({ freq: e.target.value as RecurrenceFreq })
                                            }
                                        >
                                            {(Object.keys(FREQ_UNITS) as RecurrenceFreq[]).map((f) => (
                                                <option key={f} value={f}>
                                                    {FREQ_UNITS[f]}
                                                    {customRepeat.interval === "1" ? "" : "s"}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {customRepeat.freq === "WEEKLY" && (
                                    <div className="nep-weekdays">
                                        {WEEKDAYS.map((day) => (
                                            <button
                                                key={day}
                                                type="button"
                                                title={weekdayShort(day)}
                                                className={`nep-chip nep-weekday${customRepeat.byday.includes(day) ? " nep-chip-active" : ""}`}
                                                aria-pressed={customRepeat.byday.includes(day)}
                                                onClick={() => toggleWeekday(day)}
                                            >
                                                {weekdayShort(day).slice(0, 2)}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <div className="nep-repeat-line">
                                    <span className="nep-repeat-text">Ends</span>
                                    <div className="nep-chips">
                                        {(["never", "until", "count"] as const).map((t) => (
                                            <button
                                                key={t}
                                                type="button"
                                                className={`nep-chip${customRepeat.endType === t ? " nep-chip-active" : ""}`}
                                                aria-pressed={customRepeat.endType === t}
                                                onClick={() => updateCustomRepeat({ endType: t })}
                                            >
                                                {t === "never" ? "Never" : t === "until" ? "On date" : "After"}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {customRepeat.endType === "until" && (
                                    <input
                                        className="nep-input"
                                        type="date"
                                        aria-label="End date"
                                        min={toDateInput(repeatStart)}
                                        max={toDateInput(maxUntilDate(repeatStart))}
                                        value={customRepeat.until}
                                        onChange={(e) => updateCustomRepeat({ until: e.target.value })}
                                    />
                                )}
                                {customRepeat.endType === "count" && (
                                    <div className="nep-repeat-line">
                                        <input
                                            className="nep-input nep-input-narrow"
                                            type="number"
                                            min={1}
                                            max={MAX_COUNT}
                                            aria-label="Occurrence count"
                                            value={customRepeat.count}
                                            onChange={(e) => updateCustomRepeat({ count: e.target.value })}
                                        />
                                        <span className="nep-repeat-text">
                                            occurrence{customRepeat.count === "1" ? "" : "s"}
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))}
                </div>

                <div className="nep-bottom-row">
                    {onDelete && (
                        <button type="button" className="nep-btn-delete" aria-label="Delete event" onClick={onDelete}>
                            <Trash2 size={20} />
                        </button>
                    )}
                    <div />
                    <div className="nep-actions">
                        <button type="button" className="nep-btn nep-btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="nep-btn nep-btn-primary" disabled={!canSave}>
                            Save
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}

export default NewEventPopover;
