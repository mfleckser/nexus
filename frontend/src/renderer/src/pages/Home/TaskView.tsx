import "./taskview.css"

type Task = {
    id: string;
    title: string;
    done: boolean;
};

const placeholderTasks: Task[] = [
    { id: "1", title: "Review weekly goals", done: false },
    { id: "2", title: "Draft project workshop spec", done: false },
    { id: "3", title: "Wire backend Flask scaffold", done: false },
    { id: "4", title: "Sketch habit trigger model", done: false },
    { id: "5", title: "Read LifeCoach pursuits notes", done: true },
];

function TaskView(): React.JSX.Element {
    return (
        <div id="task-container">
            <div id="task-panel">
                <div className="task-header">
                    <span className="task-title">Tasks</span>
                    <button className="task-add" aria-label="Add task">+</button>
                </div>
                <div className="task-list themed-scroll">
                    {placeholderTasks.map((t) => (
                        <div key={t.id} className={`task-row${t.done ? " done" : ""}`}>
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
