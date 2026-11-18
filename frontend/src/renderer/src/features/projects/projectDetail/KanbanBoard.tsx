import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./kanbanBoard.css";
import TaskForm from "@renderer/components/TaskForm";
import { useTasks } from "../../tasks/useTasks";
import { Feature, Project, Task, TaskStatus } from "@renderer/types";
import TaskCard from "./TaskCard";
import TaskDetailModal from "./TaskDetailModal";
import FeatureLabel from "./FeatureLabel";
import { useProjects } from "../useProjects";
import useReportError from "@renderer/hooks/useReportError";
import useDragAutoScroll from "@renderer/hooks/useDragAutoScroll";
import { toDatetimeLocal } from "@renderer/lib/time";
import { TASK_STATUS_LABELS, compareCompleted, fitCount } from "@renderer/lib/kanban";

const STATUSES: { key: TaskStatus; label: string }[] = (["todo", "active", "blocked", "complete"] as const).map(
    (key) => ({ key, label: TASK_STATUS_LABELS[key] }),
);

// Stable fallback while a project's features load, so effects keyed on them don't rerun.
const NO_FEATURES: Feature[] = [];

// "general" is the synthetic row for tasks with no feature_id; it always sorts first.
const GENERAL_ROW = "general";

// Status columns keep a readable width; the board scrolls sideways when narrow. The
// column holding the inline edit form widens so the due-date input fits in full.
const COLUMN_MIN_PX = 180;
const EDIT_COLUMN_MIN_PX = 264;

function gridColumns(editingStatus: TaskStatus | null): string {
    const cols = STATUSES.map((s) => `minmax(${s.key === editingStatus ? EDIT_COLUMN_MIN_PX : COLUMN_MIN_PX}px, 1fr)`);
    return `200px ${cols.join(" ")}`;
}

// Completed cards shown in a collapsed row when no other column there has cards to
// size against.
const DEFAULT_COMPLETE_COUNT = 3;

type DropTarget = { status: TaskStatus; feature_id: string | null };

const px = (v: string) => parseFloat(v) || 0;

// Vertical padding + border of an element.
function verticalChrome(cs: CSSStyleDeclaration): number {
    return px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
}

// Height from an element's first in-flow child's top to its last one's bottom: its
// content's own height, even when the grid row stretches the element taller. Absolutely
// positioned children (the add-task popover, the measurement layer) don't count.
function contentSpan(el: Element): number {
    const inFlow = [...el.children].filter((c) => getComputedStyle(c).position !== "absolute");
    const first = inFlow[0];
    const last = inFlow[inFlow.length - 1];
    if (!first || !last) return 0;
    return last.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
}

// For each row with a measurement layer (see .kb-complete-measure), how many completed
// cards fit within the row's height as set by its feature label and other status
// columns, so a collapsed Complete column never makes the row taller.
function measureFitCounts(grid: HTMLElement): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const layer of grid.querySelectorAll<HTMLElement>(".kb-complete-measure")) {
        const cell = layer.parentElement;
        const rowKey = cell?.dataset.row;
        if (!cell || !rowKey) continue;
        const cs = getComputedStyle(cell);
        const chrome = verticalChrome(cs);
        // Cells are border-box: the content area their min-height leaves.
        let available = px(cs.minHeight) - chrome;
        const row = CSS.escape(rowKey);
        for (const other of grid.querySelectorAll(`.kb-cell[data-row="${row}"]:not(.kb-cell-complete)`)) {
            available = Math.max(available, contentSpan(other));
        }
        // The label cell has its own padding; convert its height to this cell's content area.
        const label = grid.querySelector(`.kb-feature-label[data-row="${row}"]`);
        if (label) {
            const labelHeight = contentSpan(label) + verticalChrome(getComputedStyle(label));
            available = Math.max(available, labelHeight - chrome);
        }
        const heights = [...layer.querySelectorAll(":scope > .task-card")].map(
            (el) => el.getBoundingClientRect().height,
        );
        const buttonHeight = layer.querySelector(".kb-show-more")?.getBoundingClientRect().height ?? 0;
        counts[rowKey] = fitCount(heights, px(cs.rowGap), buttonHeight, available);
    }
    return counts;
}

function sameCounts(a: Record<string, number>, b: Record<string, number>): boolean {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

function KanbanBoard({ project }: { project: Project }): React.JSX.Element {
    const [formRow, setFormRow] = useState<string | null>(null);
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [viewingTaskId, setViewingTaskId] = useState<string | null>(null);

    const [featureInput, setFeatureInput] = useState<string>("");
    const [showFeatureInput, setShowFeatureInput] = useState<boolean>(false);

    const { featuresByProjectId, loadFeatures, addFeature, renameFeature, deleteFeature } = useProjects();
    const { tasks, addTask, updateTask } = useTasks();
    const reportError = useReportError();
    const projectTasks = tasks.filter((t) => t.project_id === project.id);
    const features = featuresByProjectId[project.id] ?? NO_FEATURES;

    useEffect(() => {
        loadFeatures(project.id).catch((err) => reportError("Couldn't load features", err));
    }, [project.id, loadFeatures, reportError]);

    const rows = [
        { key: GENERAL_ROW, name: "General", featureId: null as string | null },
        ...features.map((f) => ({ key: f.id, name: f.name, featureId: f.id as string | null })),
    ];

    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

    // dragover fires continuously; only re-render when the hovered cell changes.
    const hoverCell = (status: TaskStatus, feature_id: string | null) => {
        setDropTarget((prev) =>
            prev?.status === status && prev.feature_id === feature_id ? prev : { status, feature_id },
        );
    };

    // Dragging near the board's edges scrolls it. Content moving under a still pointer
    // may not fire dragover promptly, so re-pick the hovered cell after each scroll step.
    const boardRef = useRef<HTMLDivElement>(null);
    useDragAutoScroll(boardRef, draggingId !== null, (x, y) => {
        const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>(".kb-cell");
        const { row, status } = cell?.dataset ?? {};
        if (row && status) hoverCell(status as TaskStatus, row === GENERAL_ROW ? null : row);
        else setDropTarget(null);
    });

    const statusOf = (t: Task) => {
        return STATUSES.some((s) => s.key === t.status) ? t.status : "todo";
    };

    const editingTask = projectTasks.find((t) => t.id === editingTaskId);
    const viewingTask = projectTasks.find((t) => t.id === viewingTaskId);
    const editingStatus = editingTask ? statusOf(editingTask) : null;

    // Opening the form widens its column, which can push the form past the board's
    // visible edge; bring it into view.
    const editWrapperRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        editWrapperRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [editingTaskId]);

    // Rows whose Complete column shows every completed task. In memory only.
    const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());
    const setRowExpanded = (rowKey: string, expanded: boolean) => {
        setExpandedRows((prev) => {
            const next = new Set(prev);
            if (expanded) next.add(rowKey);
            else next.delete(rowKey);
            return next;
        });
    };

    // Collapsed completed-card counts, measured before paint whenever the cards, column
    // widths or a row's label cell can change, and whenever the board resizes.
    const gridRef = useRef<HTMLDivElement>(null);
    const [fitCounts, setFitCounts] = useState<Record<string, number>>({});
    const remeasure = useCallback(() => {
        if (!gridRef.current) return;
        const next = measureFitCounts(gridRef.current);
        setFitCounts((prev) => (sameCounts(prev, next) ? prev : next));
    }, []);
    useLayoutEffect(remeasure, [remeasure, tasks, features, editingTaskId, formRow]);
    useEffect(() => {
        if (!gridRef.current) return;
        const observer = new ResizeObserver(remeasure);
        observer.observe(gridRef.current);
        return () => observer.disconnect();
    }, [remeasure]);

    const handleDrop = () => {
        setDraggingId(null);
        setDropTarget(null);
        const draggedTask = projectTasks.find((t) => t.id === draggingId);
        if (!draggedTask || !dropTarget) return;
        if (draggedTask.status !== dropTarget.status || draggedTask.feature_id !== dropTarget.feature_id) {
            updateTask(draggedTask.id, dropTarget).catch((err) => reportError("Couldn't move task", err));
        }
    };

    const handleAddFeature = () => {
        const name = featureInput.trim();
        if (!name) return;
        addFeature(project.id, name).catch((err) => reportError("Couldn't add feature", err));
        setFeatureInput("");
        setShowFeatureInput(false);
    };

    const handleCancelFeature = () => {
        setFeatureInput("");
        setShowFeatureInput(false);
    };

    return (
        <div className="kanban-container">
            <div className="kanban-header">
                <span className="kanban-title">Tasks</span>
            </div>
            <div ref={boardRef} className="kb-board themed-scroll">
                <div ref={gridRef} className="kb-grid" style={{ gridTemplateColumns: gridColumns(editingStatus) }}>
                    <div className="kb-corner" />
                    {STATUSES.map((s) => (
                        <div key={s.key} className={`kb-status-header kb-status-${s.key}`}>
                            {s.label}
                        </div>
                    ))}

                    {rows.map((row) => {
                        const rowTasks = projectTasks.filter((t) => t.feature_id === row.featureId);
                        return (
                            <Fragment key={row.key}>
                                <div className="kb-feature-label" data-row={row.key}>
                                    <FeatureLabel
                                        name={row.name}
                                        featureId={row.featureId}
                                        onLayoutChange={remeasure}
                                        onEdit={(name) => {
                                            if (!row.featureId || name === row.name) return;
                                            renameFeature(row.featureId, name).catch((err) =>
                                                reportError("Couldn't rename feature", err),
                                            );
                                        }}
                                        onDelete={() => {
                                            if (!row.featureId) return;
                                            deleteFeature(row.featureId).catch((err) =>
                                                reportError("Couldn't delete feature", err),
                                            );
                                        }}
                                    />
                                    {formRow === row.key ? (
                                        <div className="kb-task-form-wrapper">
                                            <TaskForm
                                                submitLabel="Add"
                                                onSubmit={({ title, description, dueAt }) => {
                                                    addTask(
                                                        title,
                                                        description,
                                                        dueAt,
                                                        project.id,
                                                        row.featureId ?? undefined,
                                                    ).catch((err) => reportError("Couldn't add task", err));
                                                    setFormRow(null);
                                                }}
                                                onCancel={() => {
                                                    setFormRow(null);
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            className="kb-add-task-btn"
                                            onClick={() => {
                                                setFormRow(row.key);
                                            }}
                                        >
                                            + Add task
                                        </button>
                                    )}
                                </div>
                                {STATUSES.map((s) => {
                                    const isComplete = s.key === "complete";
                                    const cellTasks = rowTasks.filter((t) => statusOf(t) === s.key);
                                    let shown = cellTasks;
                                    let toggle: React.JSX.Element | null = null;
                                    let measureLayer: React.JSX.Element | null = null;
                                    if (isComplete) {
                                        const completed = cellTasks.toSorted(compareCompleted);
                                        const sized = rowTasks.length > completed.length;
                                        const collapsedCount = sized
                                            ? (fitCounts[row.key] ?? 1)
                                            : DEFAULT_COMPLETE_COUNT;
                                        const expanded = expandedRows.has(row.key);
                                        shown = expanded ? completed : completed.slice(0, collapsedCount);
                                        // Keep a task being edited on screen even if it'd be cut.
                                        const editing = completed.find((t) => t.id === editingTaskId);
                                        if (editing && !shown.includes(editing)) shown = [...shown, editing];
                                        const hiddenCount = completed.length - shown.length;
                                        if (hiddenCount > 0 || (expanded && completed.length > collapsedCount)) {
                                            toggle = (
                                                <button
                                                    type="button"
                                                    className="kb-add-task-btn kb-show-more"
                                                    onClick={() => setRowExpanded(row.key, hiddenCount > 0)}
                                                >
                                                    {hiddenCount > 0 ? `Show ${hiddenCount} more` : "Show less"}
                                                </button>
                                            );
                                        }
                                        // Invisible copies of every completed card at the cell's
                                        // width, measured to pick collapsedCount (measureFitCounts).
                                        if (sized && completed.length > 0) {
                                            measureLayer = (
                                                <div className="kb-complete-measure" aria-hidden>
                                                    {completed.map((t) => (
                                                        <TaskCard key={t.id} task={t} compact />
                                                    ))}
                                                    <button
                                                        type="button"
                                                        className="kb-add-task-btn kb-show-more"
                                                        tabIndex={-1}
                                                    >
                                                        Show {completed.length} more
                                                    </button>
                                                </div>
                                            );
                                        }
                                    }
                                    return (
                                        <div
                                            key={s.key}
                                            data-row={row.key}
                                            data-status={s.key}
                                            className={`kb-cell${isComplete ? " kb-cell-complete" : ""}${dropTarget?.feature_id === row.featureId && dropTarget.status === s.key ? " kb-cell-dragover" : ""}`}
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                hoverCell(s.key, row.featureId);
                                            }}
                                            onDragLeave={(e) => {
                                                // Ignore moves onto the cell's own children.
                                                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                                                setDropTarget(null);
                                            }}
                                            onDrop={() => handleDrop()}
                                        >
                                            {shown.map((t) =>
                                                editingTaskId === t.id ? (
                                                    <div
                                                        key={t.id}
                                                        ref={editWrapperRef}
                                                        className="kb-task-edit-wrapper"
                                                    >
                                                        <TaskForm
                                                            submitLabel="Save"
                                                            initialTitle={t.title}
                                                            initialDescription={t.description ?? ""}
                                                            initialDueAt={toDatetimeLocal(t.due_at)}
                                                            onSubmit={({ title, description, dueAt }) => {
                                                                updateTask(t.id, {
                                                                    title,
                                                                    description,
                                                                    due_at: dueAt,
                                                                }).catch((err) =>
                                                                    reportError("Couldn't save task", err),
                                                                );
                                                                setEditingTaskId(null);
                                                            }}
                                                            onCancel={() => setEditingTaskId(null)}
                                                        />
                                                    </div>
                                                ) : (
                                                    <TaskCard
                                                        key={t.id}
                                                        task={t}
                                                        compact={isComplete}
                                                        dragging={draggingId === t.id}
                                                        onDragStart={() => setDraggingId(t.id)}
                                                        onDragEnd={() => {
                                                            setDraggingId(null);
                                                            setDropTarget(null);
                                                        }}
                                                        onEdit={() => setEditingTaskId(t.id)}
                                                        onOpen={() => setViewingTaskId(t.id)}
                                                    />
                                                ),
                                            )}
                                            {toggle}
                                            {measureLayer}
                                        </div>
                                    );
                                })}
                            </Fragment>
                        );
                    })}
                </div>
                {showFeatureInput ? (
                    <form
                        className="kb-feature-form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleAddFeature();
                        }}
                    >
                        <input
                            type="text"
                            className="kb-feature-input"
                            placeholder="Feature name"
                            value={featureInput}
                            onChange={(e) => setFeatureInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Escape") handleCancelFeature();
                            }}
                            autoFocus
                        />
                        <button
                            type="submit"
                            className="kb-feature-btn kb-feature-btn-primary"
                            disabled={!featureInput.trim()}
                        >
                            Add
                        </button>
                        <button
                            type="button"
                            className="kb-feature-btn kb-feature-btn-secondary"
                            onClick={handleCancelFeature}
                        >
                            Cancel
                        </button>
                    </form>
                ) : (
                    <button type="button" className="kb-add-feature-btn" onClick={() => setShowFeatureInput(true)}>
                        + Add feature
                    </button>
                )}
            </div>
            {viewingTask && (
                <TaskDetailModal
                    task={viewingTask}
                    featureName={
                        viewingTask.feature_id
                            ? (features.find((f) => f.id === viewingTask.feature_id)?.name ?? null)
                            : "General"
                    }
                    onEdit={() => {
                        setViewingTaskId(null);
                        setEditingTaskId(viewingTask.id);
                    }}
                    onClose={() => setViewingTaskId(null)}
                />
            )}
        </div>
    );
}

export default KanbanBoard;
