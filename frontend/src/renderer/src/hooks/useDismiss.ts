import { RefObject, useEffect, useEffectEvent } from "react";

type DismissOptions = {
    // Presses inside this element don't count as outside (e.g. the toggle
    // button that opened the popover handles them itself).
    ignoreRef?: RefObject<HTMLElement | null>;
    // Also dismiss on Escape (default true).
    escape?: boolean;
    enabled?: boolean;
};

// Calls onDismiss on a mousedown outside `ref` and (optionally) on Escape.
export default function useDismiss(
    ref: RefObject<HTMLElement | null>,
    onDismiss: () => void,
    { ignoreRef, escape = true, enabled = true }: DismissOptions = {},
): void {
    const dismiss = useEffectEvent(onDismiss);

    useEffect(() => {
        if (!enabled) return;
        function onKey(e: KeyboardEvent): void {
            if (escape && e.key === "Escape") dismiss();
        }
        function onMouseDown(e: MouseEvent): void {
            const target = e.target as Node;
            if (ref.current?.contains(target) || ignoreRef?.current?.contains(target)) return;
            dismiss();
        }
        window.addEventListener("keydown", onKey);
        window.addEventListener("mousedown", onMouseDown);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("mousedown", onMouseDown);
        };
    }, [ref, ignoreRef, escape, enabled]);
}
