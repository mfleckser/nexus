import { RefObject, useEffect, useRef } from "react";
import { AUTO_SCROLL, edgeVelocity } from "@renderer/lib/autoScroll";

// The drag's pointer position comes from dragover, which fires on whatever is under the
// pointer while it moves (and periodically while it holds still). A position older than
// this means the pointer left the window, so scrolling stops.
const STALE_MS = 1000;

// Clamp for a long frame gap (window hidden, jank) so scrolling never jumps.
const MAX_FRAME_MS = 50;
const FRAME_60HZ_MS = 1000 / 60;

/**
 * While `active` (an HTML5 drag is in progress), scrolls `ref`'s element when the
 * pointer stays near one of its edges; see AUTO_SCROLL for the tuning. `onScrolled`
 * gets the pointer's client position after each scroll step, so the caller can update
 * its drop target as content moves under a still pointer.
 */
export default function useDragAutoScroll(
    ref: RefObject<HTMLElement | null>,
    active: boolean,
    onScrolled?: (x: number, y: number) => void,
): void {
    const onScrolledRef = useRef(onScrolled);
    useEffect(() => {
        onScrolledRef.current = onScrolled;
    });

    useEffect(() => {
        const el = ref.current;
        if (!active || !el) return;

        let pointer: { x: number; y: number; at: number } | null = null;
        let zoneSince: number | null = null;
        let lastFrame: number | null = null;
        // Sub-pixel remainders, carried so slow speeds on high-refresh screens still move.
        let carryX = 0;
        let carryY = 0;

        const velocity = (x: number, y: number): [number, number] => {
            // The visible scroll area: inside the border, excluding scrollbars.
            const rect = el.getBoundingClientRect();
            const left = rect.left + el.clientLeft;
            const top = rect.top + el.clientTop;
            const right = left + el.clientWidth;
            const bottom = top + el.clientHeight;
            // Each axis counts only while the pointer is level with the area on the other
            // axis, so a pointer over the sidebar doesn't scroll the board vertically.
            const pad = AUTO_SCROLL.overshootPx;
            const levelX = x >= left - pad && x <= right + pad;
            const levelY = y >= top - pad && y <= bottom + pad;
            const vx = el.scrollWidth > el.clientWidth && levelY ? edgeVelocity(x, left, right) : 0;
            const vy = el.scrollHeight > el.clientHeight && levelX ? edgeVelocity(y, top, bottom) : 0;
            return [vx, vy];
        };

        const tick = (now: number) => {
            frame = requestAnimationFrame(tick);
            const dt = lastFrame === null ? 0 : Math.min(now - lastFrame, MAX_FRAME_MS);
            lastFrame = now;
            if (!pointer || performance.now() - pointer.at > STALE_MS) {
                zoneSince = null;
                return;
            }
            const [vx, vy] = velocity(pointer.x, pointer.y);
            if (vx === 0 && vy === 0) {
                zoneSince = null;
                carryX = carryY = 0;
                return;
            }
            zoneSince ??= now;
            if (now - zoneSince < AUTO_SCROLL.delayMs) return;
            // Speeds are per 60 Hz frame; scale so higher refresh rates scroll as fast.
            const scale = dt / FRAME_60HZ_MS;
            const stepX = vx * scale + carryX;
            const stepY = vy * scale + carryY;
            carryX = stepX - Math.trunc(stepX);
            carryY = stepY - Math.trunc(stepY);
            const { scrollLeft, scrollTop } = el;
            el.scrollBy(Math.trunc(stepX), Math.trunc(stepY));
            if (el.scrollLeft !== scrollLeft || el.scrollTop !== scrollTop) {
                onScrolledRef.current?.(pointer.x, pointer.y);
            }
        };
        let frame = requestAnimationFrame(tick);

        const onDragOver = (e: DragEvent) => {
            pointer = { x: e.clientX, y: e.clientY, at: performance.now() };
        };
        const stop = () => {
            pointer = null;
            cancelAnimationFrame(frame);
        };
        document.addEventListener("dragover", onDragOver);
        document.addEventListener("drop", stop);
        document.addEventListener("dragend", stop);
        return () => {
            stop();
            document.removeEventListener("dragover", onDragOver);
            document.removeEventListener("drop", stop);
            document.removeEventListener("dragend", stop);
        };
    }, [ref, active]);
}
