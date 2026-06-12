import "./taskform.css"
import { useState } from "react";

export type TaskFormValues = {
    title: string;
    description: string | null;
    dueAt: string | null;
};

type TaskFormProps = {
    submitLabel: string;
    onSubmit: (values: TaskFormValues) => void;
    onCancel: () => void;
    initialTitle?: string;
    initialDescription?: string;
    initialDueAt?: string;
    descriptionPlaceholder?: string;
};

function TaskForm({
    submitLabel,
    onSubmit,
    onCancel,
    initialTitle = "",
    initialDescription = "",
    initialDueAt = "",
    descriptionPlaceholder = "Description",
}: TaskFormProps): React.JSX.Element {
    const [title, setTitle] = useState(initialTitle);
    const [description, setDescription] = useState(initialDescription);
    const [dueAt, setDueAt] = useState(initialDueAt);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = title.trim();
        if (!trimmed) return;
        onSubmit({
            title: trimmed,
            description: description.trim() ? description.trim() : null,
            dueAt: dueAt ? dueAt : null,
        });
    };

    return (
        <form
            className="task-form"
            onSubmit={handleSubmit}
        >
            <input
                className="task-form-input"
                type="text"
                placeholder="Task title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                required
            />
            <textarea
                className="task-form-input task-form-textarea"
                placeholder={descriptionPlaceholder}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
            />
            <label className="task-form-field">
                <span className="task-form-label">Due</span>
                <input
                    className="task-form-input task-form-datetime"
                    type="datetime-local"
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                />
            </label>
            <div className="task-form-actions">
                <button
                    type="button"
                    className="task-form-btn task-form-btn-secondary"
                    onClick={onCancel}
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    className="task-form-btn task-form-btn-primary"
                    disabled={!title.trim()}
                >
                    {submitLabel}
                </button>
            </div>
        </form>
    );
}

export default TaskForm
