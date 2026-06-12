import "./kanbanBoard.css";

function KanbanBoard(): React.JSX.Element {
    return (
        <div className="kanban-container">
            <div className="kanban-header">
                <span className="kanban-title">Tasks</span>
            </div>
            <div className="kb-board">
                <div className="kb-grid">
                    <div className="kb-corner" />
                    <div className="kb-status-header">To Do</div>
                    <div className="kb-status-header">Active</div>
                    <div className="kb-status-header">Complete</div>

                    <div className="kb-feature-label">
                        <span className="kb-feature-name">General</span>
                        <button type="button" className="kb-add-task-btn">+ Add task</button>
                    </div>
                    <div className="kb-cell" />
                    <div className="kb-cell" />
                    <div className="kb-cell" />
                </div>
                <button type="button" className="kb-add-feature-btn">+ Add feature</button>
            </div>
        </div>
    )
}

export default KanbanBoard;
