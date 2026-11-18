import { useState } from "react";
import { Task } from "@renderer/types";
import { useEvents } from "@renderer/features/calendar/useEvents";
import { useTasks } from "@renderer/features/tasks/useTasks";
import NewEventPopover from "@renderer/features/calendar/NewEventPopover";
import { PopoverAnchor } from "@renderer/hooks/usePopoverPosition";
import useReportError from "@renderer/hooks/useReportError";
import { roundUpToQuarterHour } from "@renderer/lib/timeBlocks";

const DEFAULT_BLOCK_MINUTES = 60;

type BlockTimePopoverProps = {
    task: Task;
    anchor: PopoverAnchor;
    onClose: () => void;
};

// New-event popover for a task's time block: prefilled with the task's title
// at the coming quarter hour; saving creates the event and links the task to it.
function BlockTimePopover({ task, anchor, onClose }: BlockTimePopoverProps): React.JSX.Element {
    const { addEvent } = useEvents();
    const { updateTask } = useTasks();
    const reportError = useReportError();
    const [start] = useState(() => roundUpToQuarterHour(new Date()));
    const [end] = useState(() => new Date(start.getTime() + DEFAULT_BLOCK_MINUTES * 60000));

    return (
        <NewEventPopover
            anchor={anchor}
            initialStart={start}
            initialEnd={end}
            initialTitle={task.title}
            onSave={(draft) => {
                onClose();
                addEvent(draft).then(
                    (event) =>
                        updateTask(task.id, { event_id: event.id }).catch((err) =>
                            reportError("Couldn't link the time block to the task", err),
                        ),
                    (err) => reportError("Couldn't create the time block", err),
                );
            }}
            onClose={onClose}
        />
    );
}

export default BlockTimePopover;
