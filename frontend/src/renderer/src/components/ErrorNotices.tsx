import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import "./errorNotices.css";
import { ReportErrorContext, errorMessage } from "@renderer/hooks/useReportError";

const DISMISS_AFTER_MS = 6000;
const MAX_NOTICES = 3;

type Notice = { id: number; title: string; detail: string };

// App-wide error notices: a small stack in the bottom-right corner. Each one
// auto-dismisses; a repeat of a notice already on screen (e.g. a failing poll)
// restarts its timer instead of stacking.
export default function ErrorNoticesProvider({ children }: { children: ReactNode }) {
    const [notices, setNotices] = useState<Notice[]>([]);
    const nextId = useRef(0);
    // Notice id by "title\ndetail", for de-duplication; and dismiss timers by id.
    const idByKey = useRef(new Map<string, number>());
    const timers = useRef(new Map<number, number>());

    const dismiss = useCallback((id: number) => {
        clearTimeout(timers.current.get(id));
        timers.current.delete(id);
        idByKey.current.forEach((value, key) => {
            if (value === id) idByKey.current.delete(key);
        });
        setNotices((prev) => prev.filter((n) => n.id !== id));
    }, []);

    const report = useCallback(
        (title: string, err: unknown) => {
            console.error(title, err);
            const detail = errorMessage(err);
            const key = `${title}\n${detail}`;
            let id = idByKey.current.get(key);
            if (id === undefined) {
                const newId = nextId.current++;
                id = newId;
                idByKey.current.set(key, newId);
                setNotices((prev) => [...prev, { id: newId, title, detail }].slice(-MAX_NOTICES));
            }
            const noticeId = id;
            clearTimeout(timers.current.get(noticeId));
            timers.current.set(
                noticeId,
                window.setTimeout(() => dismiss(noticeId), DISMISS_AFTER_MS),
            );
        },
        [dismiss],
    );

    useEffect(() => {
        const pending = timers.current;
        return () => pending.forEach((timer) => clearTimeout(timer));
    }, []);

    return (
        <ReportErrorContext.Provider value={report}>
            {children}
            <div className="error-notices" aria-live="polite">
                {notices.map((n) => (
                    <div key={n.id} className="error-notice" role="alert">
                        <div className="error-notice-text">
                            <span className="error-notice-title">{n.title}</span>
                            <span className="error-notice-detail">{n.detail}</span>
                        </div>
                        <button
                            type="button"
                            className="error-notice-close"
                            aria-label="Dismiss"
                            onClick={() => dismiss(n.id)}
                        >
                            <X size={14} />
                        </button>
                    </div>
                ))}
            </div>
        </ReportErrorContext.Provider>
    );
}
