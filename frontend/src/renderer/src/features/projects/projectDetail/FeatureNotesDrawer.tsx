import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import "./featureNotesDrawer.css";
import { Feature } from "@renderer/types";
import { useProjects } from "../useProjects";
import useNow from "@renderer/hooks/useNow";
import useReportError, { errorMessage } from "@renderer/hooks/useReportError";
import { formatDueDisplay, formatRelativeTime } from "@renderer/lib/time";
import { discardedNotes, unsavedNotes } from "./notesDrafts";

const AUTOSAVE_DELAY = 800;

type SaveStatus = "idle" | "saving" | "saved" | "error";

const STATUS_LABELS: Record<SaveStatus, string | null> = {
    idle: null,
    saving: "Saving…",
    saved: "Saved",
    error: "Not saved",
};

type FeatureNotesDrawerProps = {
    // Key the drawer by feature id: it loads that feature's notes once, on mount.
    feature: Feature;
    onClose: () => void;
};

// Plain-text notes for one feature, in a drawer over the kanban board. Always editable;
// autosaves after typing pauses, on blur, and on close.
function FeatureNotesDrawer({ feature, onClose }: FeatureNotesDrawerProps): React.JSX.Element {
    const { loadFeatureNotes, updateFeatureNotes } = useProjects();
    const reportError = useReportError();
    const now = useNow(60000);
    const featureId = feature.id;

    // null until the notes load. After that the editor owns the text: saves never
    // write the server's copy back into it.
    const [draft, setDraft] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [status, setStatus] = useState<SaveStatus>("idle");

    // Save bookkeeping lives in refs so it keeps working after unmount (the close flush).
    const draftRef = useRef<string | null>(null);
    // The text the server has: from the load, then each successful save.
    const savedRef = useRef<string | null>(null);
    const savingRef = useRef(false);
    const timerRef = useRef<number | null>(null);
    const panelRef = useRef<HTMLElement>(null);
    const editorRef = useRef<HTMLTextAreaElement>(null);

    // Saves the latest text if it differs from the server's. One request at a time,
    // so an older text can't land after a newer one; a call made mid-save is picked
    // up when that save finishes.
    const save = useCallback(async () => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (savingRef.current || discardedNotes.has(featureId)) return;
        savingRef.current = true;
        try {
            let text = draftRef.current;
            while (text !== null && text !== savedRef.current) {
                setStatus("saving");
                try {
                    await updateFeatureNotes(featureId, text);
                } catch (err) {
                    unsavedNotes.set(featureId, { text: draftRef.current ?? text, base: savedRef.current ?? "" });
                    setStatus("error");
                    reportError("Couldn't save notes", err);
                    return;
                }
                savedRef.current = text;
                if (draftRef.current === text) {
                    unsavedNotes.delete(featureId);
                    setStatus("saved");
                }
                // Newer text with an autosave pending is left to that timer; otherwise
                // (typed, then blur or close mid-save) save it now.
                if (timerRef.current !== null) return;
                text = draftRef.current;
            }
        } finally {
            savingRef.current = false;
        }
    }, [featureId, updateFeatureNotes, reportError]);

    const fetchNotes = useCallback(() => {
        loadFeatureNotes(featureId)
            .then((notes) => {
                savedRef.current = notes;
                const unsaved = unsavedNotes.get(featureId);
                const text = unsaved?.text ?? notes;
                draftRef.current = text;
                setDraft(text);
                if (!unsaved || text === notes) return;
                if (unsaved.base === notes) {
                    // Retry a save that failed in an earlier drawer.
                    void save();
                } else {
                    // The notes changed on the server since: don't replace them unasked.
                    // The next edit or blur saves.
                    setStatus("error");
                    reportError(
                        "Restored unsaved notes",
                        "They've changed elsewhere since; saving replaces that version.",
                    );
                }
            })
            .catch((err) => setLoadError(errorMessage(err)));
    }, [featureId, loadFeatureNotes, save, reportError]);

    useEffect(fetchNotes, [fetchNotes]);

    // Flush pending edits when the drawer closes (on unmount only).
    const saveRef = useRef(save);
    useEffect(() => {
        saveRef.current = save;
    }, [save]);
    useEffect(() => () => void saveRef.current(), []);

    // Focus the editor once the text arrives, so typing (and Escape) work right away.
    const loaded = draft !== null;
    useEffect(() => {
        if (loaded) editorRef.current?.focus();
    }, [loaded]);

    // Escape closes the drawer, unless focus is in something else on the page (an
    // inline form, whose own Escape cancels it). Modals stop Escape before it
    // reaches window.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const active = document.activeElement;
            if (active && active !== document.body && !panelRef.current?.contains(active)) return;
            onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const handleChange = (value: string) => {
        setDraft(value);
        draftRef.current = value;
        if (status === "saved") setStatus("idle");
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            void save();
        }, AUTOSAVE_DELAY);
    };

    let body: React.JSX.Element;
    if (draft !== null) {
        body = (
            <textarea
                ref={editorRef}
                className="fn-editor themed-scroll"
                placeholder="Write feature notes…"
                aria-label={`${feature.name} notes`}
                value={draft}
                onChange={(e) => handleChange(e.target.value)}
                onBlur={() => void save()}
            />
        );
    } else if (loadError) {
        body = (
            <div className="fn-loading fn-error" role="alert">
                <span>Couldn&apos;t load notes: {loadError}</span>
                <button
                    type="button"
                    className="fn-retry"
                    onClick={() => {
                        setLoadError(null);
                        fetchNotes();
                    }}
                >
                    Retry
                </button>
            </div>
        );
    } else {
        body = <div className="fn-loading">Loading notes…</div>;
    }

    const updatedAt = feature.notes_updated_at;
    const statusLabel = STATUS_LABELS[status];

    return (
        <aside ref={panelRef} className="fn-drawer" aria-label={`${feature.name} notes`}>
            <div className="fn-header">
                <div className="fn-heading">
                    <h2 className="fn-title">{feature.name}</h2>
                    <div className="fn-meta">
                        {updatedAt ? (
                            <span title={formatDueDisplay(updatedAt)}>
                                Updated {formatRelativeTime(updatedAt, now)}
                            </span>
                        ) : (
                            <span>No edits yet</span>
                        )}
                        {statusLabel && (
                            <>
                                <span className="fn-sep">·</span>
                                <span className={`fn-status fn-status-${status}`} role="status">
                                    {statusLabel}
                                </span>
                            </>
                        )}
                    </div>
                </div>
                <button type="button" className="fn-close" aria-label="Close notes" onClick={onClose}>
                    <X size={16} />
                </button>
            </div>
            <div className="fn-body">{body}</div>
        </aside>
    );
}

export default FeatureNotesDrawer;
