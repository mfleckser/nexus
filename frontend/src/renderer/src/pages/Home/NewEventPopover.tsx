import { useEffect, useRef, useState } from "react";
import "./newEventPopover.css";
import categoryData from "./categories.json"

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

const toDateInput = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const toTimeInput = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export type NewEventDraft = {
    title: string;
    description: string;
    start_at: Date;
    duration: number;
    category: string;
    top?: number;
};

export type NewEventPopoverProps = {
    anchor: { x: number; y: number };
    initialStart: Date;
    initialDuration?: number;
    onSave: (draft: NewEventDraft) => void;
    onClose: () => void;
    setEventDraft: (draft: NewEventDraft) => void;
};

function NewEventPopover({
    anchor,
    initialStart,
    initialDuration = 60,
    onSave,
    onClose,
    setEventDraft
}: NewEventPopoverProps): React.JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("");
    const [dateStr, setDateStr] = useState(toDateInput(initialStart));
    const [timeStr, setTimeStr] = useState(toTimeInput(initialStart));
    const [duration, setDuration] = useState(initialDuration);
    const [customDuration, setCustomDuration] = useState(
        DURATION_PRESETS.includes(initialDuration) ? "" : String(initialDuration),
    );

    useEffect(() => {
        titleRef.current?.focus();
    }, []);

    useEffect(() => {
        setEventDraft({title: title, description: description, start_at: getStartAt(), duration: duration, category: category});
    }, [title, description, dateStr, timeStr, duration, category]);

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

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!title.trim()) return;
        const start_at = getStartAt();
        onSave({
            title: title.trim(),
            description: description.trim(),
            start_at,
            duration,
            category
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
        left: anchor.x,
        top: anchor.y,
    };

    return (
        <div
            ref={rootRef}
            className="new-event-popover"
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

                <div className="nep-actions">
                    <button type="button" className="nep-btn nep-btn-secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="nep-btn nep-btn-primary"
                        disabled={!title.trim()}
                    >
                        Save
                    </button>
                </div>
            </form>
        </div>
    );
}

export default NewEventPopover;
