import { addDays, minutesIntoDay, MINUTES_PER_DAY } from "./time";

export type Timed = { start_at: Date; end_at: Date };

// One day column's slice of an item. Items crossing midnight get a segment in
// every visible day they cover, clipped to that day.
export type DaySegment<T extends Timed> = {
    item: T;
    // Column index within the laid-out range, and that day's local midnight.
    dayIndex: number;
    dayStart: Date;
    // Wall-clock minutes into the day, clipped to [0, MINUTES_PER_DAY].
    startMin: number;
    endMin: number;
    // The item starts before / ends after this day.
    clippedStart: boolean;
    clippedEnd: boolean;
    // Side-by-side placement among overlapping segments of the same day:
    // this segment sits in `column` of `columns` equal-width columns.
    column: number;
    columns: number;
};

// Items whose [start, end) intersects [rangeStart, rangeEnd); zero-length
// items count when their instant falls inside the range.
export function overlapsRange(item: Timed, rangeStart: Date, rangeEnd: Date): boolean {
    const s = item.start_at.getTime();
    const e = item.end_at.getTime();
    if (e <= s) return s >= rangeStart.getTime() && s < rangeEnd.getTime();
    return s < rangeEnd.getTime() && e > rangeStart.getTime();
}

function daySegment<T extends Timed>(item: T, dayIndex: number, dayStart: Date, dayEnd: Date): DaySegment<T> | null {
    if (!overlapsRange(item, dayStart, dayEnd)) return null;
    const clippedStart = item.start_at < dayStart;
    const clippedEnd = item.end_at > dayEnd;
    const startMin = clippedStart ? 0 : minutesIntoDay(item.start_at);
    // An end exactly at the next midnight (or later) fills the day.
    const endMin = item.end_at >= dayEnd ? MINUTES_PER_DAY : minutesIntoDay(item.end_at);
    return {
        item,
        dayIndex,
        dayStart,
        startMin,
        endMin: Math.max(startMin, endMin),
        clippedStart,
        clippedEnd,
        column: 0,
        columns: 1,
    };
}

// Greedy column assignment for one day: segments sorted by start (longer
// first on ties) are grouped into clusters of transitively overlapping
// segments; each takes the first column free at its start, and every segment
// in a cluster shares the cluster's column count.
function assignColumns<T extends Timed>(segments: DaySegment<T>[]): void {
    segments.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
    // Zero-length segments still occupy a sliver, so they collide with
    // anything at the same instant.
    const endOf = (s: DaySegment<T>): number => Math.max(s.endMin, s.startMin + 1);

    let cluster: DaySegment<T>[] = [];
    let columnEnds: number[] = [];
    let clusterEnd = -Infinity;
    const flush = (): void => {
        for (const s of cluster) s.columns = columnEnds.length;
        cluster = [];
        columnEnds = [];
    };

    for (const seg of segments) {
        if (seg.startMin >= clusterEnd) flush();
        let column = columnEnds.findIndex((end) => end <= seg.startMin);
        if (column === -1) column = columnEnds.length;
        columnEnds[column] = endOf(seg);
        seg.column = column;
        cluster.push(seg);
        clusterEnd = Math.max(clusterEnd, endOf(seg));
    }
    flush();
}

// Lays out `items` over `days` consecutive day columns starting at local
// midnight `rangeStart`.
export function layoutDays<T extends Timed>(items: T[], rangeStart: Date, days: number): DaySegment<T>[] {
    const result: DaySegment<T>[] = [];
    for (let i = 0; i < days; i++) {
        const dayStart = addDays(rangeStart, i);
        const dayEnd = addDays(rangeStart, i + 1);
        const segments: DaySegment<T>[] = [];
        for (const item of items) {
            const seg = daySegment(item, i, dayStart, dayEnd);
            if (seg) segments.push(seg);
        }
        assignColumns(segments);
        result.push(...segments);
    }
    return result;
}
