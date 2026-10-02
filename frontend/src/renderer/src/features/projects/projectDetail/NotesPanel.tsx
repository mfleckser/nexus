import { useEffect, useRef, useState } from "react";
import "./notesPanel.css";

const AUTOSAVE_DELAY = 800;

type NotesPanelProps = {
    // undefined until loaded.
    notes: string | undefined;
    // Set when loading failed.
    loadError: string | null;
    onRetry: () => void;
    // Reports its own failures.
    onSave: (notes: string) => Promise<void>;
};

function NotesPanel({ notes, loadError, onRetry, onSave }: NotesPanelProps): React.JSX.Element {
    // null until the server's notes arrive. After that the editor owns the
    // text, so the post-save echo through the provider can't clobber newer
    // keystrokes.
    const [draft, setDraft] = useState<string | null>(notes ?? null);
    if (draft === null && notes !== undefined) setDraft(notes);

    // Autosave bookkeeping lives in refs so typing only touches local draft state.
    const saveTimer = useRef<number | null>(null);
    // Text typed but not yet handed to onSave.
    const unsaved = useRef<string | null>(null);
    const onSaveRef = useRef(onSave);
    useEffect(() => {
        onSaveRef.current = onSave;
    }, [onSave]);

    // Flush a pending save on unmount (panel closed or navigation mid-debounce).
    useEffect(
        () => () => {
            if (saveTimer.current) clearTimeout(saveTimer.current);
            if (unsaved.current !== null) void onSaveRef.current(unsaved.current);
        },
        [],
    );

    const handleChange = (value: string) => {
        setDraft(value);
        unsaved.current = value;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
            const text = unsaved.current;
            unsaved.current = null;
            if (text !== null) void onSaveRef.current(text);
        }, AUTOSAVE_DELAY);
    };

    let body: React.JSX.Element;
    if (draft !== null) {
        body = (
            <textarea
                className="np-editor themed-scroll"
                placeholder="Write project notes…"
                aria-label="Project notes"
                value={draft}
                onChange={(e) => handleChange(e.target.value)}
            />
        );
    } else if (loadError) {
        body = (
            <div className="np-loading np-error" role="alert">
                <span>Couldn&apos;t load notes: {loadError}</span>
                <button type="button" className="np-retry" onClick={onRetry}>
                    Retry
                </button>
            </div>
        );
    } else {
        body = <div className="np-loading">Loading notes…</div>;
    }

    return (
        <aside className="np-container">
            <div className="np-header">
                <span className="np-title">Notes</span>
            </div>
            <div className="np-panel">{body}</div>
        </aside>
    );
}

export default NotesPanel;
