import { useEffect, useState } from "react";

export default function useNow(intervalMs: number = 60000): Date {
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const intervalId = setInterval(() => setNow(new Date()), intervalMs);
        return () => clearInterval(intervalId);
    }, [intervalMs]);

    return now;
}