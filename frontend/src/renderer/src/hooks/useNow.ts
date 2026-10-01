import { useEffect, useState } from "react";

// Current time, refreshed every `intervalMs` and whenever the window regains focus.
export default function useNow(intervalMs: number = 60000): Date {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const intervalId = setInterval(() => setNow(new Date()), intervalMs);
        return () => clearInterval(intervalId);
    }, [intervalMs]);

    // onWindowFocus returns its own unsubscribe, leaving other subscribers alone.
    useEffect(() => window.api.onWindowFocus(() => setNow(new Date())), []);

    return now;
}
