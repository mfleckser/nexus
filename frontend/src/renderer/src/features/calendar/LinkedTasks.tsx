import "./linkedTasks.css";
import { Task } from "@renderer/types";
import { useTasks } from "@renderer/features/tasks/useTasks";
import useReportError from "@renderer/hooks/useReportError";

// The tasks an event is a time block for, in the event popover. Ticking one
// completes the task straight away (not part of the event form's Save).
function LinkedTasks({ tasks }: { tasks: Task[] }): React.JSX.Element | null {
    const { updateTask } = useTasks();
    const reportError = useReportError();
    if (!tasks.length) return null;

    return (
        <div className="nep-field-row">
            <span className="nep-label">{tasks.length === 1 ? "Task" : "Tasks"}</span>
            <ul className="linked-tasks">
                {tasks.map((t) => {
                    const done = t.status === "complete";
                    return (
                        <li key={t.id} className={`linked-task${done ? " done" : ""}`}>
                            <button
                                type="button"
                                className="linked-task-check"
                                aria-label={done ? `Mark ${t.title} incomplete` : `Mark ${t.title} complete`}
                                aria-pressed={done}
                                onClick={() =>
                                    updateTask(t.id, { status: done ? "todo" : "complete" }).catch((err) =>
                                        reportError("Couldn't update task", err),
                                    )
                                }
                            />
                            <span className="linked-task-title">{t.title}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

export default LinkedTasks;
