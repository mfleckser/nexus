import "./taskview.css"
import { useTasks } from "../../hooks/useTasks"
import { useState } from "react";


function TaskView(): React.JSX.Element {
    const {tasks, addTask} = useTasks();
    const [showForm, setShowForm] = useState(false);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [dueAt, setDueAt] = useState("");

    const resetForm = () => {
        setTitle("");
        setDescription("");
        setDueAt("");
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;
        addTask(title, description, dueAt);
        resetForm();
        setShowForm(false);
    };

    const handleCancel = () => {
        resetForm();
        setShowForm(false);
    };

    return (
        <div id="task-container">
            <div id="task-panel">
                <div className="task-header">
                    <span className="task-title">Tasks</span>
                    <button
                        className="task-add"
                        aria-label={showForm ? "Close add task" : "Add task"}
                        onClick={() => setShowForm((v) => !v)}
                    >
                        {showForm ? "×" : "+"}
                    </button>
                </div>
                {showForm && (
                    <form className="task-form" onSubmit={handleSubmit}>
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
                            placeholder="Description (optional)"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={2}
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
                                onClick={handleCancel}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="task-form-btn task-form-btn-primary"
                                disabled={!title.trim()}
                            >
                                Add
                            </button>
                        </div>
                    </form>
                )}
                <div className="task-list themed-scroll">
                    {tasks.map((t) => (
                        <div key={t.id} className={`task-row${t.status == "complete" ? " done" : ""}`}>
                            <span className="task-check" aria-hidden />
                            <span className="task-label">{t.title}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default TaskView
