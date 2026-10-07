import { ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import "./modal.css";
import { X } from "lucide-react";

type ModalProps = {
    onClose: () => void;
    title: string;
    children: ReactNode;
};

export default function Modal({ onClose, title, children }: ModalProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const titleId = useId();

    // Move focus into the dialog unless a child already took it (children's
    // effects run first, e.g. a form focusing its first field).
    useEffect(() => {
        const panel = containerRef.current;
        if (!panel || panel.contains(document.activeElement)) return;
        const first = panel.querySelector<HTMLElement>(
            ".modal-body button, .modal-body input, .modal-body textarea, .modal-body select",
        );
        (first ?? panel).focus();
    }, []);

    useEffect(() => {
        // Escape belongs to the modal: stop it reaching window listeners
        // (the event popover behind it, calendar shortcuts).
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const onBackdropMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
            onClose();
        }
    };

    // Portaled to <body> so an ancestor's pointer-events / stacking context
    // (e.g. the calendar's events overlay) can't swallow clicks or bury it.
    // React events still bubble through the component tree, so the backdrop's
    // stopPropagation keeps outside-click listeners (popovers) from firing.
    return createPortal(
        <div className="modal-backdrop" onMouseDown={onBackdropMouseDown}>
            <div
                className="modal-panel"
                ref={containerRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                <div className="modal-header">
                    <h2 className="modal-title" id={titleId}>
                        {title}
                    </h2>
                    <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>
                <div className="modal-body">{children}</div>
            </div>
        </div>,
        document.body,
    );
}
