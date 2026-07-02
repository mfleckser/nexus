import { useEffect, useRef, useState } from "react";
import "./newProjectModal.css";
import Modal from "@renderer/components/Modal";

const PROJECT_TYPES = ["coding", "learning", "fitness", "other"];

type NewProjectModalProps = {
    onClose: () => void;
    onSave: (title: string, description: string, type: string) => void;
};

function NewProjectModal({ onClose, onSave }: NewProjectModalProps): React.JSX.Element {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [type, setType] = useState("");
    const titleRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        titleRef.current?.focus();
    }, []);

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        onSave(title, description, type);
        onClose();
    }

    return (
        <Modal onClose={onClose} title="New Project">
            <form className="np-form" onSubmit={handleSubmit}>
                <label className="np-field">
                    <span className="np-label">Title</span>
                    <input
                        ref={titleRef}
                        className="np-input"
                        type="text"
                        placeholder="Project title"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                    />
                </label>

                <label className="np-field">
                    <span className="np-label">Description</span>
                    <textarea
                        className="np-input np-textarea"
                        placeholder="What is this project about?"
                        rows={3}
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                    />
                </label>

                <div className="np-field">
                    <span className="np-label">
                        Type<span className="np-optional">optional</span>
                    </span>
                    <div className="np-type-options">
                        {PROJECT_TYPES.map(t => (
                            <button
                                key={t}
                                type="button"
                                className={`np-type-option${type === t ? " np-type-option-selected" : ""}`}
                                onClick={() => setType(type === t ? "" : t)}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="np-actions">
                    <button type="button" className="np-btn np-btn-secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="submit" className="np-btn np-btn-primary" disabled={!title.trim()}>
                        Create
                    </button>
                </div>
            </form>
        </Modal>
    );
}

export default NewProjectModal;
