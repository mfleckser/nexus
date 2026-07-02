import { useEffect, useRef, useState } from "react";
import "./projectModal.css";
import Modal from "@renderer/components/Modal";

const PROJECT_TYPES = ["coding", "learning", "fitness", "other"];
const PROJECT_STATUSES = ["planning", "active", "paused", "complete", "archived"];

export type ProjectFormValues = {
    title: string;
    description: string;
    type: string;
    status: string;
};

type ProjectModalProps = {
    heading: string;
    submitLabel: string;
    onClose: () => void;
    onSave: (values: ProjectFormValues) => void;
    initial?: ProjectFormValues;
};

function ProjectModal({ heading, submitLabel, onClose, onSave, initial }: ProjectModalProps): React.JSX.Element {
    const [title, setTitle] = useState(initial?.title ?? "");
    const [description, setDescription] = useState(initial?.description ?? "");
    const [type, setType] = useState(initial?.type ?? "");
    const [status, setStatus] = useState(initial?.status ?? "");
    const titleRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        titleRef.current?.focus();
    }, []);

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        onSave({ title, description, type, status });
        onClose();
    }

    return (
        <Modal onClose={onClose} title={heading}>
            <form className="pm-form" onSubmit={handleSubmit}>
                <label className="pm-field">
                    <span className="pm-label">Title</span>
                    <input
                        ref={titleRef}
                        className="pm-input"
                        type="text"
                        placeholder="Project title"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                    />
                </label>

                <label className="pm-field">
                    <span className="pm-label">Description</span>
                    <textarea
                        className="pm-input pm-textarea"
                        placeholder="What is this project about?"
                        rows={3}
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                    />
                </label>

                <div className="pm-field">
                    <span className="pm-label">
                        Type<span className="pm-optional">optional</span>
                    </span>
                    <div className="pm-options">
                        {PROJECT_TYPES.map(t => (
                            <button
                                key={t}
                                type="button"
                                className={`pm-option${type === t ? " pm-option-selected" : ""}`}
                                onClick={() => setType(type === t ? "" : t)}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                </div>

                {initial && (
                    <div className="pm-field">
                        <span className="pm-label">Status</span>
                        <div className="pm-options">
                            {PROJECT_STATUSES.map(s => (
                                <button
                                    key={s}
                                    type="button"
                                    className={`pm-option${status === s ? " pm-option-selected" : ""}`}
                                    onClick={() => setStatus(s)}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="pm-actions">
                    <button type="button" className="pm-btn pm-btn-secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="submit" className="pm-btn pm-btn-primary" disabled={!title.trim()}>
                        {submitLabel}
                    </button>
                </div>
            </form>
        </Modal>
    );
}

export default ProjectModal;
