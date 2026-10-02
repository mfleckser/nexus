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

export const TASK_PIN_HEIGHT = 18;
// Snap increment for dragging task pins.
export const TASK_SNAP_MINUTES = 15;
