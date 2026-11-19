import { addDays, zonedMidnight, type EventCreate, type TaskCreate } from "@nexus/shared";

// Quick add picks times on a grid of this many minutes.
export const STEP_MINUTES = 15;
export const LAST_SLOT = 24 * 60 - STEP_MINUTES;

// Event length choices, in minutes.
export const DURATIONS = [30, 60, 90, 120] as const;

// Tasks are due late in the evening unless a time is picked.
export const DEFAULT_TASK_DUE_MINUTES = 23 * 60 + 30;

// `minutes` of wall-clock time into `day`'s date.
export const atMinutes = (day: Date, minutes: number): Date =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);

// A new event starts at the next whole hour (the last slot late at night).
export function defaultEventStart(now: Date): number {
    return Math.min((now.getHours() + 1) * 60, LAST_SLOT);
}

// `minutes` moved `steps` grid steps, wrapping around the day.
export function stepMinutes(minutes: number, steps: number): number {
    const day = 24 * 60;
    return (((minutes + steps * STEP_MINUTES) % day) + day) % day;
}

export const deviceTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function taskCreateBody(title: string, day: Date, dueMinutes: number): TaskCreate {
    return { title: title.trim(), due_at: atMinutes(day, dueMinutes).toISOString() };
}

export type EventDraft = {
    title: string;
    day: Date;
    allDay: boolean;
    startMinutes: number;
    durationMinutes: number;
    timeZone: string;
};

// An all-day event covers `day` in `timeZone` (midnight to midnight); a timed
// one starts at startMinutes on `day`.
export function eventCreateBody(draft: EventDraft): EventCreate {
    const base = { title: draft.title.trim(), timezone: draft.timeZone };
    if (draft.allDay) {
        return {
            ...base,
            all_day: true,
            start_at: zonedMidnight(draft.day, draft.timeZone).toISOString(),
            end_at: zonedMidnight(addDays(draft.day, 1), draft.timeZone).toISOString(),
        };
    }
    const start = atMinutes(draft.day, draft.startMinutes);
    const end = new Date(start.getTime() + draft.durationMinutes * 60000);
    return { ...base, all_day: false, start_at: start.toISOString(), end_at: end.toISOString() };
}
