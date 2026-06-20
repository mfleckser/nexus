import { ReactNode, useEffect, useRef } from "react";
import "./modal.css";
import { X } from "lucide-react";

type ModalProps = {
    onClose: () => void;
    title: string;
    children: ReactNode;
};

export default function Modal({ onClose, title, children } : ModalProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
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

    return (
        <div className="modal-backdrop" onMouseDown={onBackdropMouseDown}>
            <div className="modal-panel" ref={containerRef} role="dialog" aria-modal="true">
                <div className="modal-header">
                    <h2 className="modal-title">{title}</h2>
                    <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>
                <div className="modal-body">{children}</div>
            </div>
        </div>
    );
}
