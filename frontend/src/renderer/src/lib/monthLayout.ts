import { DayBar, DayItem, daySpan, layoutDayBars } from "./allDay";

// An item drawn as a bar across a month week row: all-day, or spanning more
// than one day.
export const isBarItem = (item: DayItem): boolean => {
    if (item.all_day) return true;
    const { first, last } = daySpan(item);
    return first.getTime() !== last.getTime();
};

export type MonthDay<T> = {
    // The day's single-day items that fit, and the slot each sits in.
    items: { item: T; row: number }[];
    // Items of the day that don't fit (bars and single-day items), and the
    // slot of the "+N more" line; more = 0 when everything fits.
    more: number;
    moreRow: number;
};

// One week row of the month view, in slots of equal height: bars across the
// days they cover in the top slots (layoutDayBars), each day's single-day
// items in the slots below its lowest bar, `slots` per day cell. A day that
// can't fit everything keeps its last slot for "+N more"; a bar shows only if
// its slot is free on every day it covers, and counts toward "+N more" of
// each of those days otherwise. `dayItems` holds each of the 7 days' items,
// already in display order.
export function layoutMonthWeek<B extends DayItem, T>(
    barItems: B[],
    dayItems: T[][],
    weekStart: Date,
    slotCount: number,
): { bars: DayBar<B>[]; days: MonthDay<T>[] } {
    const slots = Math.max(1, slotCount);
    const { bars } = layoutDayBars(barItems, weekStart, 7);
    const covers = (bar: DayBar<B>, day: number): boolean => day >= bar.startIndex && day < bar.startIndex + bar.span;
    // Slots usable for content per day: all of them, or one fewer once the
    // day overflows. A day only ever starts overflowing, so this settles.
    const overflows = Array<boolean>(7).fill(false);
    const limit = (d: number): number => (overflows[d] ? slots - 1 : slots);
    let visible: boolean[] = [];
    let changed = true;
    while (changed) {
        changed = false;
        visible = bars.map((bar) => {
            let min = slots;
            for (let d = bar.startIndex; d < bar.startIndex + bar.span; d++) min = Math.min(min, limit(d));
            return bar.row < min;
        });
        for (let d = 0; d < 7; d++) {
            if (overflows[d]) continue;
            const top = firstFreeRow(bars, visible, d, covers);
            const hiddenBar = bars.some((bar, i) => !visible[i] && covers(bar, d));
            if (hiddenBar || dayItems[d].length > slots - top) {
                overflows[d] = true;
                changed = true;
            }
        }
    }

    const days = dayItems.map((items, d): MonthDay<T> => {
        const top = firstFreeRow(bars, visible, d, covers);
        const fit = items.slice(0, Math.max(0, limit(d) - top));
        const hiddenBars = bars.filter((bar, i) => !visible[i] && covers(bar, d)).length;
        return {
            items: fit.map((item, i) => ({ item, row: top + i })),
            more: hiddenBars + items.length - fit.length,
            moreRow: top + fit.length,
        };
    });
    return { bars: bars.filter((_, i) => visible[i]), days };
}

// Slot below the lowest shown bar covering `day`.
function firstFreeRow<B>(
    bars: DayBar<B>[],
    visible: boolean[],
    day: number,
    covers: (bar: DayBar<B>, day: number) => boolean,
): number {
    let top = 0;
    bars.forEach((bar, i) => {
        if (visible[i] && covers(bar, day)) top = Math.max(top, bar.row + 1);
    });
    return top;
}
