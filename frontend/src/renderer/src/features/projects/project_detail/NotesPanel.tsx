import { useEffect, useRef, useState } from "react";
import "./notesPanel.css";

const AUTOSAVE_DELAY = 800;

type NotesPanelProps = {
    notes: string | undefined;
    onSave: (notes: string) => Promise<void>;
};

function NotesPanel({ notes, onSave }: NotesPanelProps): React.JSX.Element {
    const [draft, setDraft] = useState(notes ?? "");
    const initialized = useRef(notes !== undefined);

    // Autosave bookkeeping lives in refs so typing only touches local draft state.
    const saveTimer = useRef<number | null>(null);
    const draftRef = useRef(draft);
    const pendingSave = useRef(false);
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;

    // Sync from server only on first load; after that the editor owns the text,
    // so the post-save echo through the provider can't clobber newer keystrokes.
    useEffect(() => {
        if (!initialized.current && notes !== undefined) {
            initialized.current = true;
            setDraft(notes);
            draftRef.current = notes;
        }
    }, [notes]);

    // Flush a pending save on unmount (panel closed or navigation mid-debounce).
    useEffect(() => () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        if (pendingSave.current) onSaveRef.current(draftRef.current);
    }, []);

    const handleChange = (value: string) => {
        setDraft(value);
        draftRef.current = value;
        pendingSave.current = true;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
            pendingSave.current = false;
            onSaveRef.current(draftRef.current);
        }, AUTOSAVE_DELAY);
    };

    return (
        <aside className="np-container">
            <div className="np-header">
                <span className="np-title">Notes</span>
            </div>
            <div className="np-panel">
                {initialized.current || notes !== undefined ? (
                    <textarea
                        className="np-editor themed-scroll"
                        placeholder="Write project notes…"
                        value={draft}
                        onChange={e => handleChange(e.target.value)}
                    />
                ) : (
                    <div className="np-loading">Loading notes…</div>
                )}
            </div>
        </aside>
    );
}

export default NotesPanel;
