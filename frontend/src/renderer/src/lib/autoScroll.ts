// Edge auto-scroll while dragging: holding the pointer near an edge of a scroll area
// scrolls it that way, faster the closer the pointer is to the edge.

export type AutoScrollTuning = {
    zonePx: number;
    delayMs: number;
    minSpeed: number;
    maxSpeed: number;
    overshootPx: number;
};

// Tuning knobs, all in one place.
export const AUTO_SCROLL: AutoScrollTuning = {
    /** Width of the hot zone along each edge of the visible scroll area, in px. */
    zonePx: 80,
    /** How long the pointer must stay in a hot zone before scrolling starts, in ms. */
    delayMs: 250,
    /** Speed at the inner edge of the zone, in px per 60 Hz frame. */
    minSpeed: 2,
    /** Speed at the very edge of the area (or past it), in px per 60 Hz frame. */
    maxSpeed: 20,
    /** How far past an edge the pointer still counts (at max speed), in px. Further out
     * it's over something else (sidebar, notes panel) and nothing scrolls. */
    overshootPx: 32,
};

/**
 * Scroll velocity along one axis for a pointer at `pos`, where the visible area spans
 * `start`..`end`: negative toward `start`, positive toward `end`, 0 outside both zones.
 * Ramps linearly from minSpeed at the zone's inner edge to maxSpeed at (or past) the
 * area's edge, up to overshootPx beyond it. When the zones overlap in a small area, the
 * nearer edge wins.
 */
export function edgeVelocity(pos: number, start: number, end: number, tuning: AutoScrollTuning = AUTO_SCROLL): number {
    const { zonePx, minSpeed, maxSpeed, overshootPx } = tuning;
    const toStart = pos - start;
    const toEnd = end - pos;
    if (toStart < -overshootPx || toEnd < -overshootPx) return 0;
    const speed = (dist: number) => minSpeed + (maxSpeed - minSpeed) * (1 - Math.max(0, dist) / zonePx);
    if (toStart < zonePx && toStart <= toEnd) return -speed(toStart);
    if (toEnd < zonePx) return speed(toEnd);
    return 0;
}
