// Week-grid geometry. Must match .hour-label / .hour-block height in calendar.css.
export const PX_PER_HOUR = 48;
export const PX_PER_MIN = PX_PER_HOUR / 60;

// Snap increment for creating, moving and resizing events.
export const SLOT_MINUTES = 30;
export const MIN_EVENT_MINUTES = 30;
// Length of an event created by a plain click on the grid.
export const DEFAULT_EVENT_MINUTES = 60;

// Gap between a chip/pin and the popover it opens.
export const POPOVER_GAP = 8;
// Mouse travel (px) below which a press is a click, not a drag/resize.
export const DRAG_THRESHOLD = 3;

// Height (px) of an event chip's title + time header: shorter chips show both
// on one line, and task pins never cover it. Must cover .event-chip padding +
// .event-chip-title + .event-chip-time line heights in calendar.css (~28px).
export const EVENT_HEADER_PX = 30;

export const TASK_PIN_HEIGHT = 18;
// Inset (px) of a task pin from each side of its column.
export const TASK_PIN_INSET = 3;
// Snap increment for dragging task pins.
export const TASK_SNAP_MINUTES = 15;

// Height (px) of one stacked row of bars in the all-day row. Must match
// .all-day-chip height + gap in calendar.css.
export const ALL_DAY_ROW_PX = 22;
