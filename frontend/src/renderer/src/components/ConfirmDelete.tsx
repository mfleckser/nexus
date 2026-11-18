import "./confirmDelete.css";
import Modal from "./Modal";

type ConfirmDeleteProps = {
    onClose: () => void;
    onDelete: () => void;
    itemName: string;
    /** Extra consequences of the delete, shown under the standard warning. */
    details?: string;
};

export default function ConfirmDelete({ onClose, onDelete, itemName, details }: ConfirmDeleteProps) {
    return (
        <Modal onClose={onClose} title={`Delete ${itemName}?`}>
            <div className="cd-subtext">This {itemName} will be permanently removed. This can&apos;t be undone.</div>
            {details && <div className="cd-subtext">{details}</div>}
            <div className="cd-btns">
                <button type="button" className="cd-btn cd-btn-cancel" onClick={onClose}>
                    Cancel
                </button>
                <button type="button" className="cd-btn cd-btn-delete" onClick={onDelete}>
                    Delete
                </button>
            </div>
        </Modal>
    );
}
