import { useEffect, useRef } from "react";
import "./ConfirmDelete.css";

type ConfirmDeleteProps = {
    onClose: () => void;
    onDelete: () => void;
    itemName: string;
};

export default function ConfirmDelete({ onClose, onDelete, itemName } : ConfirmDeleteProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const onOverlayMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
            onClose();
        }
    };

    return (
        <div className="cd-overlay" onMouseDown={onOverlayMouseDown}>
            <div className="cd-container" ref={containerRef} role="dialog" aria-modal="true">
                <div className="cd-text">Delete {itemName}?</div>
                <div className="cd-subtext">
                    This {itemName} will be permanently removed. This can&apos;t be undone.
                </div>
                <div className="cd-btns">
                    <button type="button" className="cd-btn cd-btn-cancel" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="button" className="cd-btn cd-btn-delete" onClick={onDelete}>
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}
