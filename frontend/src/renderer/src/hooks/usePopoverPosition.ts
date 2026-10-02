import { RefObject, useLayoutEffect, useState } from "react";

// x/y: preferred top-left corner (viewport px). flipX: right edge to place
// the popover against instead when it would overflow the window's right side
// at x (e.g. the left edge of the chip it belongs to).
export type PopoverAnchor = { x: number; y: number; flipX?: number };

const MARGIN = 8;

// Fixed-position coordinates for a popover at `anchor`, kept inside the
// window and re-clamped whenever the popover resizes.
export default function usePopoverPosition(
    ref: RefObject<HTMLElement | null>,
    anchor: PopoverAnchor,
): { left: number; top: number } {
    const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });
    const { x, y, flipX } = anchor;

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const clamp = (): void => {
            const maxTop = window.innerHeight - el.offsetHeight - MARGIN;
            const maxLeft = window.innerWidth - el.offsetWidth - MARGIN;
            const left = x > maxLeft && flipX !== undefined ? flipX - el.offsetWidth : x;
            setPos({
                left: Math.max(MARGIN, Math.min(left, maxLeft)),
                top: Math.max(MARGIN, Math.min(y, maxTop)),
            });
        };
        clamp();
        const observer = new ResizeObserver(clamp);
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref, x, y, flipX]);

    return pos;
}
