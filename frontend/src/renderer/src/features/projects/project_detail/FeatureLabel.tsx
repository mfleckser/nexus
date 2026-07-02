import { useEffect, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import ConfirmDelete from "@renderer/components/ConfirmDelete";

type FeatureLabelProps = {
    name: string;
    // null for the synthetic "General" row — it has no menu.
    featureId: string | null;
    onEdit?: (name: string) => void;
    onDelete?: () => void;
};

function FeatureLabel({ name, featureId, onEdit, onDelete }: FeatureLabelProps): React.JSX.Element {
    const [menuOpen, setMenuOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [editInput, setEditInput] = useState(name);
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!menuOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [menuOpen]);

    const handleEditSubmit = () => {
        const next = editInput.trim();
        if (!next) return;
        onEdit?.(next);
        setEditing(false);
    };

    const handleEditCancel = () => {
        setEditInput(name);
        setEditing(false);
    };

    if (editing) {
        return (
            <form className="kb-feature-edit-form" onSubmit={(e) => { e.preventDefault(); handleEditSubmit(); }}>
                <input
                    type="text"
                    className="kb-feature-input"
                    value={editInput}
                    onChange={(e) => setEditInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") handleEditCancel(); }}
                    autoFocus
                />
                <div className="kb-feature-edit-actions">
                    <button type="submit" className="kb-feature-btn kb-feature-btn-primary" disabled={!editInput.trim()}>Save</button>
                    <button type="button" className="kb-feature-btn kb-feature-btn-secondary" onClick={handleEditCancel}>Cancel</button>
                </div>
            </form>
        );
    }

    return (
        <div className="kb-feature-header">
            <span className="kb-feature-name">{name}</span>
            {featureId !== null && (
                <div className="kb-feature-menu-container" ref={menuRef}>
                    <button
                        type="button"
                        className={`kb-feature-menu-btn${menuOpen ? " open" : ""}`}
                        aria-label="Feature actions"
                        onClick={() => setMenuOpen(prev => !prev)}
                    >
                        <Ellipsis size={15} />
                    </button>
                    {menuOpen && (
                        <div className="kb-feature-menu">
                            <button
                                type="button"
                                onClick={() => { setMenuOpen(false); setEditInput(name); setEditing(true); }}
                            >
                                Edit
                            </button>
                            <button
                                type="button"
                                className="kb-feature-menu-danger"
                                onClick={() => { setMenuOpen(false); setShowConfirmDelete(true); }}
                            >
                                Delete
                            </button>
                        </div>
                    )}
                </div>
            )}
            {showConfirmDelete && <ConfirmDelete
                onClose={() => setShowConfirmDelete(false)}
                onDelete={() => { onDelete?.(); setShowConfirmDelete(false); }}
                itemName="feature"
            />}
        </div>
    );
}

export default FeatureLabel;
