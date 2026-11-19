import { useEffect, useState } from "react";

// The current time, refreshed every 30 s so "Today" moves at midnight.
export default function useNow(): Date {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(timer);
    }, []);
    return now;
}
