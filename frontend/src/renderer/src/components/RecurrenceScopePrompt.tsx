import { useEffect, useId, useRef, useState } from "react";
import "./ConfirmDelete.css";
import "./recurrenceScopePrompt.css";
import Modal from "./Modal";
import { RecurrenceScope } from "@renderer/types";

const SCOPE_LABELS: Record<RecurrenceScope, string> = {
    this: "This event",
    following: "This and following events",
    all: "All events",
};

type RecurrenceScopePromptProps = {
    action: "edit" | "delete";
    // Options offered, in display order; the first is preselected.
    scopes?: RecurrenceScope[];
    onCancel: () => void;
    onConfirm: (scope: RecurrenceScope) => void;
};

export default function RecurrenceScopePrompt({
    action,
    scopes = ["this", "following", "all"],
    onCancel,
    onConfirm
} : RecurrenceScopePromptProps): React.JSX.Element {
    const [scope, setScope] = useState<RecurrenceScope>(scopes[0]);
    const optionsRef = useRef<HTMLDivElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const groupName = useId();
    // Read at first render, before the commit that may make its container
    // inert (and blur it).
    const [previousFocus] = useState(() => document.activeElement as HTMLElement | null);

    // Focus the preselected option; hand focus back (e.g. to the edit popover) on close.
    useEffect(() => {
        optionsRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
        return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
    }, [previousFocus]);

    // Capture phase + stopPropagation: while open, keys belong to this dialog —
    // not the calendar's shortcuts, the popover behind it, or Modal's own
    // Escape handler (which would cancel a second time).
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent): void {
            e.stopPropagation();
            const dialog = optionsRef.current?.closest<HTMLElement>('[role="dialog"]');
            if (e.key === "Tab" && dialog) {
                // Trap focus: cycle through the dialog's buttons and the checked radio.
                e.preventDefault();
                const stops = Array.from(dialog.querySelectorAll<HTMLElement>("button, input:checked"));
                if (!stops.length) return;
                const idx = stops.indexOf(document.activeElement as HTMLElement);
                const next = idx === -1
                    ? (e.shiftKey ? stops.length - 1 : 0)
                    : (idx + (e.shiftKey ? -1 : 1) + stops.length) % stops.length;
                stops[next].focus();
            } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
            } else if (e.key === "Enter") {
                // A held Enter from the popover's submit must not also confirm.
                if (e.repeat) return;
                const active = document.activeElement;
                // Let a focused Cancel / close button activate itself.
                if (active instanceof HTMLButtonElement && active !== confirmRef.current && dialog?.contains(active)) return;
                e.preventDefault();
                onConfirm(scope);
            }
        }
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [scope, onCancel, onConfirm]);

    const isDelete = action === "delete";

    return (
        <Modal onClose={onCancel} title={isDelete ? "Delete recurring event" : "Edit recurring event"}>
            <div className="rsp-options" ref={optionsRef} role="radiogroup">
                {scopes.map(s => (
                    <label key={s} className={`rsp-option${scope === s ? " rsp-option-selected" : ""}`}>
                        <input
                            type="radio"
                            className="rsp-radio"
                            name={groupName}
                            value={s}
                            checked={scope === s}
                            onChange={() => setScope(s)}
                        />
                        <span>{SCOPE_LABELS[s]}</span>
                    </label>
                ))}
            </div>
            <div className="cd-btns">
                <button type="button" className="cd-btn cd-btn-cancel" onClick={onCancel}>
                    Cancel
                </button>
                <button
                    ref={confirmRef}
                    type="button"
                    className={`cd-btn ${isDelete ? "cd-btn-delete" : "rsp-btn-ok"}`}
                    onClick={() => onConfirm(scope)}
                >
                    {isDelete ? "Delete" : "OK"}
                </button>
            </div>
        </Modal>
    );
}
