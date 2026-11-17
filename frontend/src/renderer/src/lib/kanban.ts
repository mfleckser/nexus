type Completable = { completed_at: Date | null };

// Most recently completed first; tasks with no completed_at go last.
function compareCompleted(a: Completable, b: Completable): number {
    if (!a.completed_at || !b.completed_at) {
        return (a.completed_at ? 0 : 1) - (b.completed_at ? 0 : 1);
    }
    return b.completed_at.getTime() - a.completed_at.getTime();
}

// How many stacked cards (heights in px, `gap` between them) fit in `available` px.
// If they don't all fit, room is kept for a `buttonHeight` "show more" button after
// the last one shown. Always at least 1 when there are any cards.
function fitCount(heights: number[], gap: number, buttonHeight: number, available: number): number {
    const total = heights.reduce((sum, h) => sum + h, 0) + gap * Math.max(heights.length - 1, 0);
    if (total <= available) return heights.length;
    let used = 0;
    let count = 0;
    for (const h of heights) {
        const next = used + (count > 0 ? gap : 0) + h;
        if (next + gap + buttonHeight > available) break;
        used = next;
        count++;
    }
    return Math.max(count, Math.min(heights.length, 1));
}

export { compareCompleted, fitCount };
