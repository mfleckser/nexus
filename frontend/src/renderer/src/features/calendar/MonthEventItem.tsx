import { useRef } from "react";
import { Repeat } from "lucide-react";
import { CalendarEvent, Task } from "@renderer/types";
import useEventEditor from "@renderer/features/calendar/useEventEditor";
import { categoryColor } from "@renderer/features/calendar/categories";
import { formatTime } from "@renderer/lib/time";
import { describeRrule } from "@nexus/shared";

type MonthEventItemProps = {
    // A single-day timed event (all-day and multi-day ones are bars).
    event: CalendarEvent;
    // Tasks this event is a time block for.
    linkedTasks: Task[];
    // Placement in the week row, set by MonthView.
    style: React.CSSProperties;
};

// One line in a month day cell: category dot, start time, title. Click to
// open the edit popover.
function MonthEventItem({ event, linkedTasks, style }: MonthEventItemProps): React.JSX.Element {
    const itemRef = useRef<HTMLDivElement>(null);
    const { isOccurrence, popoverOpen, openPopover, overlays } = useEventEditor(event, linkedTasks);
    const time = formatTime(event.start_at);

    function open(): void {
        const rect = itemRef.current?.getBoundingClientRect();
        if (rect) openPopover(rect);
    }

    return (
        <>
            <div
                ref={itemRef}
                className="month-item month-event"
                role="button"
                tabIndex={0}
                aria-expanded={popoverOpen}
                title={`${time} ${event.title}`}
                style={{ ...style, ["--chip-background" as string]: categoryColor(event.category) }}
                onClick={open}
                onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    open();
                }}
            >
                <span className="month-event-dot" />
                <span className="month-item-time">{time}</span>
                <span className="month-item-title">{event.title}</span>
                {isOccurrence && (
                    <Repeat className="month-item-repeat" size={10} aria-label="Repeats">
                        <title>{describeRrule(event.rrule, event.start_at)}</title>
                    </Repeat>
                )}
            </div>
            {overlays}
        </>
    );
}

export default MonthEventItem;
