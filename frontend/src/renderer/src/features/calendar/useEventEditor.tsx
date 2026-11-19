import { useState } from "react";
import { useEvents } from "@renderer/features/calendar/useEvents";
import { useTasks } from "@renderer/features/tasks/useTasks";
import LinkedTasks from "@renderer/features/calendar/LinkedTasks";
import { EventUpdate } from "@renderer/features/calendar/events.api";
import { CalendarEvent, NewEventDraft, RecurrenceScope, Task } from "@renderer/types";
import NewEventPopover from "@renderer/features/calendar/NewEventPopover";
import ConfirmDelete from "@renderer/components/ConfirmDelete";
import RecurrenceScopePrompt from "@renderer/components/RecurrenceScopePrompt";
import { POPOVER_GAP } from "@renderer/features/calendar/constants";
import { allDayTimes, daySpan, zonedMidnight } from "@renderer/lib/allDay";
import { browserTimeZone } from "@renderer/lib/time";
import { sameRrule } from "@nexus/shared";
import useReportError from "@renderer/hooks/useReportError";
import { PopoverAnchor } from "@renderer/hooks/usePopoverPosition";

// A mutation of a recurring occurrence waiting on the scope prompt.
type PendingScope = { action: "edit"; data: EventUpdate; scopes?: RecurrenceScope[] } | { action: "delete" };

// The event's times as the edit form shows them: an all-day event's dates
// (in its own timezone) as local midnights, [first day, day after the last).
export function formTimes(event: CalendarEvent): { start_at: Date; end_at: Date } {
    if (!event.all_day) return { start_at: event.start_at, end_at: event.end_at };
    const { first, last } = daySpan(event);
    return allDayTimes(first, last);
}

// Update moving `event` to [start_at, end_at), all-day or not. All-day
// times come in as the viewer's local midnights and are re-anchored to the
// event's own timezone, which stays as it is. all_day is sent when it
// changes, and always for an occurrence: a series edited from one takes that
// occurrence's kind.
export function timesUpdate(event: CalendarEvent, start_at: Date, end_at: Date, all_day: boolean): EventUpdate {
    const data: EventUpdate = all_day
        ? { start_at: zonedMidnight(start_at, event.timezone), end_at: zonedMidnight(end_at, event.timezone) }
        : { start_at, end_at };
    if (all_day !== (event.all_day === true) || event.recurring_event_id !== null) data.all_day = all_day;
    return data;
}

export type EventEditor = {
    isOccurrence: boolean;
    popoverOpen: boolean;
    // Open the edit popover beside `rect` (the clicked chip).
    openPopover: (rect: DOMRect) => void;
    // Plain events commit straight away; occurrences wait for a scope.
    requestUpdate: (data: EventUpdate, scopes?: RecurrenceScope[]) => void;
    // The edit popover, delete confirmation and scope prompt, when open.
    overlays: React.JSX.Element;
};

// Editing shared by the time-grid chips and the all-day bars. `linkedTasks`
// (tasks this event is a time block for) are listed in the popover.
// `onScopeSettled` runs when the scope prompt closes either way (e.g. to drop
// a drag preview).
export default function useEventEditor(
    event: CalendarEvent,
    linkedTasks: Task[],
    onScopeSettled?: () => void,
): EventEditor {
    const [pendingScope, setPendingScope] = useState<PendingScope | null>(null);
    // Edit popover anchor, captured from the chip's rect on open; null = closed.
    const [popoverAnchor, setPopoverAnchor] = useState<PopoverAnchor | null>(null);
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);
    const { updateEvent, deleteEvent } = useEvents();
    const { refreshTasks } = useTasks();
    const reportError = useReportError();

    // Deleting event rows (the event itself, or overrides/masters an edit of
    // a series drops) clears tasks' event_id server-side (FK on delete set
    // null), possibly for tasks linked to other rows: refetch tasks after
    // every successful event change.
    function afterEventChange(pending: Promise<void>, failure: string): void {
        pending.then(
            () => refreshTasks().catch((err) => reportError("Couldn't refresh tasks", err)),
            (err) => reportError(failure, err),
        );
    }

    function removeEvent(scope?: RecurrenceScope): void {
        afterEventChange(deleteEvent(event, scope), "Couldn't delete event");
    }

    const isOccurrence = event.recurring_event_id !== null;
    const shown = formTimes(event);
    const allDay = event.all_day === true;

    function requestUpdate(data: EventUpdate, scopes?: RecurrenceScope[]): void {
        if (!isOccurrence) {
            afterEventChange(updateEvent(event, data), "Couldn't save event");
            return;
        }
        setPendingScope({ action: "edit", data, scopes });
    }

    function confirmScope(scope: RecurrenceScope): void {
        const pending = pendingScope;
        if (!pending) return;
        // Same batch as the hook's synchronous optimistic update, so the chip
        // goes straight from the preview to the updated event — no flash of
        // the old position before the post-mutation refetch remounts it.
        setPendingScope(null);
        onScopeSettled?.();
        setPopoverAnchor(null);
        if (pending.action === "delete") {
            removeEvent(scope);
        } else {
            afterEventChange(updateEvent(event, pending.data, scope), "Couldn't save event");
        }
    }

    function cancelScope(): void {
        setPendingScope(null);
        onScopeSettled?.();
    }

    const handlePopoverSave = (draft: NewEventDraft): void => {
        // Only fields the user changed: an unchanged field must not overwrite
        // other occurrences' values under "all"/"following".
        let data: EventUpdate = {};
        if (draft.title !== event.title) data.title = draft.title;
        if (draft.description !== (event.description ?? "")) data.description = draft.description;
        if ((draft.category || null) !== (event.category || null)) data.category = draft.category;
        const timesChanged =
            draft.all_day !== allDay ||
            draft.start_at.getTime() !== shown.start_at.getTime() ||
            draft.end_at.getTime() !== shown.end_at.getTime();
        if (timesChanged) {
            const times = timesUpdate(event, draft.start_at, draft.end_at, draft.all_day);
            // A timed edit that keeps the kind sends only the moved ends.
            if (!draft.all_day && !allDay) {
                if (draft.start_at.getTime() === event.start_at.getTime()) delete times.start_at;
                if (draft.end_at.getTime() === event.end_at.getTime()) delete times.end_at;
            }
            data = { ...data, ...times };
        }
        // Only send rrule when the picker changed it: an unchanged rule must not
        // be rewritten (the backend treats an rrule change as a series reshape).
        // Compared semantically — the picker may re-emit an equivalent rule in
        // a different form (e.g. UNTIL after a series split).
        // Send the browser timezone with a timed one: the backend expands
        // BYDAY/monthday in the row's timezone, and older rows were stored as
        // UTC. An all-day event keeps its zone, where its midnights are.
        const rruleChanged = draft.rrule !== undefined && !sameRrule(draft.rrule, event.rrule, shown.start_at);
        if (rruleChanged) {
            data.rrule = draft.rrule;
            if (!draft.all_day) data.timezone = browserTimeZone();
        }

        if (!Object.keys(data).length) {
            setPopoverAnchor(null);
            return;
        }
        if (!isOccurrence) {
            requestUpdate(data);
            setPopoverAnchor(null);
            return;
        }
        // The popover stays open behind the prompt so Cancel returns to the
        // edits. "This event" can't change a rule (the backend ignores rrule
        // for it), so rule changes only offer series scopes.
        requestUpdate(data, rruleChanged ? ["following", "all"] : undefined);
    };

    const handlePopoverDelete = (): void => {
        // For an occurrence the scope prompt is the confirmation.
        if (isOccurrence) setPendingScope({ action: "delete" });
        else setShowConfirmDelete(true);
    };

    function openPopover(rect: DOMRect): void {
        setPopoverAnchor({ x: rect.right + POPOVER_GAP, y: rect.top, flipX: rect.left - POPOVER_GAP });
    }

    const overlays = (
        <>
            {/* Inert behind the scope prompt: its form must not be edited or
                submitted while a pending change is waiting on a scope. */}
            {popoverAnchor && (
                <div inert={pendingScope !== null}>
                    <NewEventPopover
                        anchor={popoverAnchor}
                        initialStart={shown.start_at}
                        initialEnd={shown.end_at}
                        initialAllDay={allDay}
                        initialTitle={event.title}
                        initialDescription={event.description || ""}
                        initialCategory={event.category || ""}
                        initialRrule={event.rrule}
                        extraFields={<LinkedTasks tasks={linkedTasks} />}
                        onSave={handlePopoverSave}
                        onClose={() => setPopoverAnchor(null)}
                        onDelete={handlePopoverDelete}
                    />
                </div>
            )}
            {showConfirmDelete && (
                <ConfirmDelete
                    onClose={() => setShowConfirmDelete(false)}
                    onDelete={() => {
                        removeEvent();
                        setShowConfirmDelete(false);
                    }}
                    itemName="event"
                />
            )}
            {pendingScope && (
                <RecurrenceScopePrompt
                    action={pendingScope.action}
                    scopes={pendingScope.action === "edit" ? pendingScope.scopes : undefined}
                    onCancel={cancelScope}
                    onConfirm={confirmScope}
                />
            )}
        </>
    );

    return { isOccurrence, popoverOpen: popoverAnchor !== null, openPopover, requestUpdate, overlays };
}
