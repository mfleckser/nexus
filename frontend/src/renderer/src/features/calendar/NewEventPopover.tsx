import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import "./newEventPopover.css";
import categoryData from "./categories.json"
import { NewEventDraft } from "@renderer/types";
import {
    Recurrence, RecurrenceFreq, RepeatPreset, Weekday, WEEKDAYS, MAX_COUNT,
    buildRrule, parseRrule, presetRecurrence, matchPreset, presetLabel, describeRecurrence,
    weekdayOf, weekdayShort, firstOccurrenceDay, maxUntilDate,
} from "@renderer/lib/rrule";

const DURATION_PRESETS = [30, 45, 60, 90, 120];
const REPEAT_PRESETS: RepeatPreset[] = ["none", "daily", "weekdays", "weekly", "monthly", "yearly"];
const FREQ_UNITS: Record<RecurrenceFreq, string> = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" };

const toDateInput = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const toTimeInput = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

const parseDateInput = (s: string): Date | null => {
    const [y, mo, da] = s.split("-").map(Number);
    const d = new Date(y, mo - 1, da);
    return s && !Number.isNaN(d.getTime()) ? d : null;
};

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
        until: toDateInput(rec.end.type === "until"
            ? rec.end.date
            : new Date(start.getFullYear(), start.getMonth() + 1, start.getDate())),
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

const defaultCustomForm = (start: Date): CustomRepeatForm =>
    customFormFrom(presetRecurrence("weekly", start)!, start);

function initialRepeatState(rrule: string | null | undefined, start: Date):
    { mode: RepeatMode; custom: CustomRepeatForm; unknown: boolean } {
    if (!rrule) return { mode: "none", custom: defaultCustomForm(start), unknown: false };
    const rec = parseRrule(rrule, start);
    if (!rec) return { mode: "custom", custom: defaultCustomForm(start), unknown: true };
    return { mode: matchPreset(rec, start) ?? "custom", custom: customFormFrom(rec, start), unknown: false };
}

export type NewEventPopoverProps = {
    // flipX: right edge to place the popover against when it would overflow
    // the window's right side at x (e.g. the left edge of the chip it edits).
    anchor: { x: number; y: number; flipX?: number };
    initialStart: Date;
    initialDuration?: number;
    initialTitle?: string;
    initialDescription?: string;
    initialCategory?: string;
    // Existing event's RRULE body (edit mode). Emitted unchanged unless the
    // user touches the Repeat controls.
    initialRrule?: string | null;
    onSave: (draft: NewEventDraft) => void;
    onClose: () => void;
    onDelete?: () => void;
    setEventDraft: (draft: NewEventDraft) => void;
};

function NewEventPopover({
    anchor,
    initialStart,
    initialDuration = 60,
    initialTitle = "",
    initialDescription = "",
    initialCategory = "",
    initialRrule,
    onSave,
    onClose,
    onDelete,
    setEventDraft
}: NewEventPopoverProps): React.JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);

    const [title, setTitle] = useState(initialTitle);
    const [description, setDescription] = useState(initialDescription);
    const [category, setCategory] = useState(initialCategory);
    const [dateStr, setDateStr] = useState(toDateInput(initialStart));
    const [timeStr, setTimeStr] = useState(toTimeInput(initialStart));
    const [duration, setDuration] = useState(initialDuration);
    const [customDuration, setCustomDuration] = useState(
        DURATION_PRESETS.includes(initialDuration) ? "" : String(initialDuration),
    );
    const [top, setTop] = useState(anchor.y);
    const [left, setLeft] = useState(anchor.x);

    const [initialRepeat] = useState(() => initialRepeatState(initialRrule, initialStart));
    const [repeatMode, setRepeatMode] = useState<RepeatMode>(initialRepeat.mode);
    const [customRepeat, setCustomRepeat] = useState<CustomRepeatForm>(initialRepeat.custom);
    const [repeatTouched, setRepeatTouched] = useState(false);
    const showUnknownRule = initialRepeat.unknown && !repeatTouched;

    const startAt = getStartAt();
    // Labels/presets follow the chosen start; fall back while the date input is mid-edit.
    const repeatStart = Number.isNaN(startAt.getTime()) ? initialStart : startAt;
    const customRecurrence = repeatMode === "custom" ? customFormToRecurrence(customRepeat, repeatStart) : null;
    const rrule = computeRrule();

    useEffect(() => {
        titleRef.current?.focus();
    }, []);

    // Re-clamp whenever the popover grows/shrinks (custom repeat section, textarea resize).
    useLayoutEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        const margin = 8;
        const clamp = () => {
            const maxTop = window.innerHeight - el.offsetHeight - margin;
            setTop(Math.max(margin, Math.min(anchor.y, maxTop)));
            const maxLeft = window.innerWidth - el.offsetWidth - margin;
            const x = anchor.x > maxLeft && anchor.flipX !== undefined ? anchor.flipX - el.offsetWidth : anchor.x;
            setLeft(Math.max(margin, Math.min(x, maxLeft)));
        };
        clamp();
        const observer = new ResizeObserver(clamp);
        observer.observe(el);
        return () => observer.disconnect();
    }, [anchor.x, anchor.y, anchor.flipX]);

    useEffect(() => {
        setEventDraft({title: title, description: description, start_at: getStartAt(), duration: duration, category: category, rrule: rrule ?? null});
    }, [title, description, dateStr, timeStr, duration, category, rrule]);

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        function onClick(e: MouseEvent) {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                onClose();
            }
        }
        window.addEventListener("keydown", onKey);
        window.addEventListener("mousedown", onClick);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("mousedown", onClick);
        };
    }, [onClose]);

    function getStartAt() {
        const [y, mo, da] = dateStr.split("-").map(Number);
        const [h, mi] = timeStr.split(":").map(Number);
        return new Date(y, mo - 1, da, h, mi);
    }

    // undefined = custom form currently invalid.
    function computeRrule(): string | null | undefined {
        if (initialRrule && !repeatTouched) return initialRrule;
        if (repeatMode === "custom") return customRecurrence ? buildRrule(customRecurrence) : undefined;
        const rec = presetRecurrence(repeatMode, repeatStart);
        return rec ? buildRrule(rec) : null;
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!title.trim() || rrule === undefined) return;
        const start_at = getStartAt();
        onSave({
            title: title.trim(),
            description: description.trim(),
            start_at,
            duration,
            category,
            rrule
        });
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
        setCustomRepeat(prev => ({ ...prev, ...patch }));
    }

    function toggleWeekday(day: Weekday) {
        const has = customRepeat.byday.includes(day);
        if (has && customRepeat.byday.length === 1) return; // weekly needs at least one day
        updateCustomRepeat({
            byday: has ? customRepeat.byday.filter(d => d !== day) : [...customRepeat.byday, day],
        });
    }

    function selectPreset(mins: number) {
        setDuration(mins);
        setCustomDuration("");
    }

    function onCustomChange(v: string) {
        setCustomDuration(v);
        const n = parseInt(v, 10);
        if (!Number.isNaN(n) && n > 0) setDuration(n);
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
            onMouseDown={e => e.stopPropagation()}
        >
            <form onSubmit={handleSubmit}>
                <input
                    ref={titleRef}
                    className="nep-title"
                    type="text"
                    placeholder="Add title"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                />

                <textarea
                    className="nep-description"
                    placeholder="Description (optional)"
                    rows={2}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                />

                <div className="nep-field-row">
                    <label className="nep-label">Category</label>
                    <div className="nep-category-container">
                        {categoryData
                            .filter(cat => cat.name !== "none")
                            .map(cat => (
                                <button
                                    key={cat.name}
                                    type="button"
                                    className={`nep-category-option${category === cat.name ? " nep-category-option-selected" : ""}`}
                                    onClick={() => setCategory(category === cat.name ? "" : cat.name)}
                                >
                                    {cat.name}
                                </button>
                            ))}
                    </div>
                </div>

                <div className="nep-field-row">
                    <label className="nep-label">Start</label>
                    <div className="nep-datetime">
                        <input
                            className="nep-input"
                            type="date"
                            value={dateStr}
                            onChange={e => setDateStr(e.target.value)}
                        />
                        <input
                            className="nep-input"
                            type="time"
                            value={timeStr}
                            onChange={e => setTimeStr(e.target.value)}
                        />
                    </div>
                </div>

                <div className="nep-field-row">
                    <label className="nep-label">Duration</label>
                    <div className="nep-duration">
                        <div className="nep-chips">
                            {DURATION_PRESETS.map(mins => (
                                <button
                                    key={mins}
                                    type="button"
                                    className={`nep-chip${duration === mins && customDuration === "" ? " nep-chip-active" : ""}`}
                                    onClick={() => selectPreset(mins)}
                                >
                                    {mins < 60 ? `${mins}m` : mins % 60 === 0 ? `${mins / 60}h` : `${Math.floor(mins / 60)}h${mins % 60}`}
                                </button>
                            ))}
                        </div>
                        <input
                            className="nep-input nep-custom"
                            type="number"
                            min={1}
                            placeholder="Custom (min)"
                            value={customDuration}
                            onChange={e => onCustomChange(e.target.value)}
                        />
                    </div>
                </div>

                <div className="nep-field-row">
                    <label className="nep-label">Repeat</label>
                    <div className="nep-select-wrapper">
                        <select
                            className="nep-select"
                            value={repeatMode}
                            onChange={e => onRepeatModeChange(e.target.value as RepeatMode)}
                        >
                            {REPEAT_PRESETS.map(p => (
                                <option key={p} value={p}>{presetLabel(p, repeatStart)}</option>
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
                    {repeatMode === "custom" && (showUnknownRule ? (
                        <div className="nep-repeat-custom">
                            <p className="nep-repeat-note">
                                This event uses a rule the picker can't edit. It's kept as-is unless you change it.
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
                                    value={customRepeat.interval}
                                    onChange={e => updateCustomRepeat({ interval: e.target.value })}
                                />
                                <div className="nep-select-wrapper nep-select-grow">
                                    <select
                                        className="nep-select"
                                        value={customRepeat.freq}
                                        onChange={e => updateCustomRepeat({ freq: e.target.value as RecurrenceFreq })}
                                    >
                                        {(Object.keys(FREQ_UNITS) as RecurrenceFreq[]).map(f => (
                                            <option key={f} value={f}>
                                                {FREQ_UNITS[f]}{customRepeat.interval === "1" ? "" : "s"}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {customRepeat.freq === "WEEKLY" && (
                                <div className="nep-weekdays">
                                    {WEEKDAYS.map(day => (
                                        <button
                                            key={day}
                                            type="button"
                                            title={weekdayShort(day)}
                                            className={`nep-chip nep-weekday${customRepeat.byday.includes(day) ? " nep-chip-active" : ""}`}
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
                                    {(["never", "until", "count"] as const).map(t => (
                                        <button
                                            key={t}
                                            type="button"
                                            className={`nep-chip${customRepeat.endType === t ? " nep-chip-active" : ""}`}
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
                                    min={toDateInput(repeatStart)}
                                    max={toDateInput(maxUntilDate(repeatStart))}
                                    value={customRepeat.until}
                                    onChange={e => updateCustomRepeat({ until: e.target.value })}
                                />
                            )}
                            {customRepeat.endType === "count" && (
                                <div className="nep-repeat-line">
                                    <input
                                        className="nep-input nep-input-narrow"
                                        type="number"
                                        min={1}
                                        max={MAX_COUNT}
                                        value={customRepeat.count}
                                        onChange={e => updateCustomRepeat({ count: e.target.value })}
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
                    {onDelete && <button type="button" className="nep-btn-delete" onClick={onDelete}>
                        <Trash2 size={20}/>
                    </button>}
                    <div />
                    <div className="nep-actions">
                        <button type="button" className="nep-btn nep-btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="nep-btn nep-btn-primary"
                            disabled={!title.trim() || rrule === undefined}
                        >
                            Save
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}

export default NewEventPopover;
