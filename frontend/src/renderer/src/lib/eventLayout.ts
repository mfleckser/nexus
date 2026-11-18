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

// `item`'s slice of the day [dayStart, dayEnd), not yet placed in a column;
// null if it doesn't touch that day.
export function daySegment<T extends Timed>(
    item: T,
    dayIndex: number,
    dayStart: Date,
    dayEnd: Date,
): DaySegment<T> | null {
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

// A point-in-time item (a due task) drawn as a fixed-height marker at its
// instant, placed among the day's segments.
export type DayMarker<M> = {
    item: M;
    dayIndex: number;
    // Wall-clock minutes into the day of the marker's top edge: its instant,
    // pulled up so a late marker still fits above midnight.
    startMin: number;
    // Horizontal placement as fractions of the day column's width.
    left: number;
    width: number;
};

export type MarkerLayout = {
    // Marker height, in grid minutes.
    markerMinutes: number;
    // Height of an event chip's title + time header, in grid minutes. Markers
    // never cover a header, but may sit over the rest of an event's body.
    headerMinutes: number;
};

// One box being placed in a day. `head` is how far down it must stay
// uncovered by markers; `column` and `overlay` are filled in by assignColumns.
type Slot = { start: number; end: number; head: number; column: number; overlay: boolean } & (
    | { kind: "event"; seg: { column: number; columns: number } }
    | { kind: "marker"; marker: { left: number; width: number } }
);

// Classic greedy packing of intervals sorted by start into side-by-side
// columns: each takes the first free column, and every interval in a cluster
// of transitively overlapping ones shares the cluster's column count.
function packColumns(slots: { start: number; end: number }[]): { column: number; columns: number }[] {
    const placed: { column: number; columns: number }[] = [];
    let clusterStart = 0;
    let columnEnds: number[] = [];
    let clusterEnd = -Infinity;
    const flush = (upTo: number): void => {
        for (let i = clusterStart; i < upTo; i++) placed[i].columns = columnEnds.length;
        clusterStart = upTo;
        columnEnds = [];
    };
    slots.forEach((slot, i) => {
        if (slot.start >= clusterEnd) flush(i);
        let column = columnEnds.findIndex((end) => end <= slot.start);
        if (column === -1) column = columnEnds.length;
        columnEnds[column] = slot.end;
        placed.push({ column, columns: 0 });
        clusterEnd = Math.max(clusterEnd, slot.end);
    });
    flush(slots.length);
    return placed;
}

// Column assignment for one day. Slots sorted by start (longer first on ties)
// form clusters of transitively overlapping slots; every event in a cluster
// shares the cluster's column count. Each slot takes the first column that is
// empty at its start (a new one if none is). A marker with no empty column
// instead sits over an event's body, in the first column whose header is
// past; markers over the same column split its width between themselves, so
// they never widen the cluster or narrow the event beneath.
function assignColumns(slots: Slot[]): void {
    slots.sort((a, b) => a.start - b.start || b.end - a.end);

    let cluster: Slot[] = [];
    let columnEnds: number[] = [];
    let columnHeads: number[] = [];
    let clusterEnd = -Infinity;
    const flush = (): void => {
        placeCluster(cluster, columnEnds.length);
        cluster = [];
        columnEnds = [];
        columnHeads = [];
    };

    for (const slot of slots) {
        if (slot.start >= clusterEnd) flush();
        let column = columnEnds.findIndex((end) => end <= slot.start);
        if (column === -1 && slot.kind === "marker") {
            column = columnHeads.findIndex((head) => head <= slot.start);
            slot.overlay = column !== -1;
        }
        if (column === -1) column = columnEnds.length;
        // An overlay marker still keeps events from starting under it, but
        // leaves the column's head to its event so later markers can join it.
        columnEnds[column] = Math.max(columnEnds[column] ?? -Infinity, slot.end);
        if (!slot.overlay) columnHeads[column] = slot.head;
        slot.column = column;
        cluster.push(slot);
        clusterEnd = Math.max(clusterEnd, slot.end);
    }
    flush();
}

function placeCluster(cluster: Slot[], columns: number): void {
    const overlays = new Map<number, (Slot & { kind: "marker" })[]>();
    for (const slot of cluster) {
        if (slot.kind === "event") {
            slot.seg.column = slot.column;
            slot.seg.columns = columns;
        } else if (slot.overlay) {
            overlays.set(slot.column, [...(overlays.get(slot.column) ?? []), slot]);
        } else {
            slot.marker.left = slot.column / columns;
            slot.marker.width = 1 / columns;
        }
    }
    for (const group of overlays.values()) {
        packColumns(group).forEach(({ column, columns: subs }, i) => {
            const { marker, column: host } = group[i];
            marker.left = (host + column / subs) / columns;
            marker.width = 1 / (columns * subs);
        });
    }
}

// Zero-length segments still occupy a sliver, so they collide with anything
// at the same instant. Every day's slice draws its own header, clipped or not.
function segmentSlot<T extends Timed>(seg: DaySegment<T>, headerMinutes: number): Slot {
    const end = Math.max(seg.endMin, seg.startMin + 1);
    const head = Math.min(end, seg.startMin + headerMinutes);
    return { kind: "event", start: seg.startMin, end, head, column: 0, overlay: false, seg };
}

// Lays out `items` over `days` consecutive day columns starting at local
// midnight `rangeStart`.
export function layoutDays<T extends Timed>(items: T[], rangeStart: Date, days: number): DaySegment<T>[] {
    return layoutDaysWithMarkers(items, [], rangeStart, days, { markerMinutes: 0, headerMinutes: 0 }).segments;
}

// layoutDays, plus `markers` placed at their instants (`at`) in the same
// columns: side by side with each other and with event headers they'd cover,
// over event bodies. Markers outside the range are dropped.
export function layoutDaysWithMarkers<T extends Timed, M>(
    items: T[],
    markers: { item: M; at: Date }[],
    rangeStart: Date,
    days: number,
    { markerMinutes, headerMinutes }: MarkerLayout,
): { segments: DaySegment<T>[]; markers: DayMarker<M>[] } {
    const segments: DaySegment<T>[] = [];
    const placed: DayMarker<M>[] = [];
    for (let i = 0; i < days; i++) {
        const dayStart = addDays(rangeStart, i);
        const dayEnd = addDays(rangeStart, i + 1);
        // Kept in start order, so later chips draw over earlier ones.
        const daySegments = items
            .map((item) => daySegment(item, i, dayStart, dayEnd))
            .filter((seg) => seg !== null)
            .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
        segments.push(...daySegments);
        const slots = daySegments.map((seg) => segmentSlot(seg, headerMinutes));
        for (const { item, at } of markers) {
            if (at < dayStart || at >= dayEnd) continue;
            const startMin = Math.min(minutesIntoDay(at), MINUTES_PER_DAY - markerMinutes);
            const marker: DayMarker<M> = { item, dayIndex: i, startMin, left: 0, width: 1 };
            placed.push(marker);
            const end = startMin + Math.max(markerMinutes, 1);
            slots.push({ kind: "marker", start: startMin, end, head: end, column: 0, overlay: false, marker });
        }
        assignColumns(slots);
    }
    return { segments, markers: placed };
}
