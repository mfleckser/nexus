// Build / parse the small RRULE subset the recurrence picker emits. Expansion
// happens server-side (python-dateutil); the frontend only needs to round-trip
// picker values. Anything outside the subset parses to null ("custom rule"),
// and callers must then leave the original string untouched.

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
export type RecurrenceFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurrenceEnd =
    | { type: "never" }
    // Local calendar day; occurrences on that day are included.
    | { type: "until"; date: Date }
    | { type: "count"; n: number };

export type Recurrence = {
    freq: RecurrenceFreq;
    interval: number;
    // WEEKLY only (always non-empty after parse); empty for other freqs.
    // Monthly/yearly repeat on the start's day-of-month / month.
    byday: Weekday[];
    end: RecurrenceEnd;
};

export type RepeatPreset = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export const WEEKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
export const WORKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR"];
export const MAX_COUNT = 1000; // backend limit

const JS_DAY_TO_WEEKDAY: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_SHORT: Record<Weekday, string> = {
    MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun",
};
const DAY_LONG: Record<Weekday, string> = {
    MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday",
};
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FREQS: RecurrenceFreq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const KNOWN_PARTS = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "UNTIL", "COUNT", "WKST"]);

export const weekdayOf = (d: Date): Weekday => JS_DAY_TO_WEEKDAY[d.getDay()];
export const weekdayShort = (w: Weekday): string => DAY_SHORT[w];

const pad = (n: number): string => String(n).padStart(2, "0");

const sortWeekdays = (days: Weekday[]): Weekday[] =>
    WEEKDAYS.filter(w => days.includes(w));

const sameDays = (a: Weekday[], b: Weekday[]): boolean =>
    a.length === b.length && a.every(d => b.includes(d));

const isWeekday = (v: string): v is Weekday => (WEEKDAYS as string[]).includes(v);
const isFreq = (v: string | undefined): v is RecurrenceFreq => !!v && (FREQS as string[]).includes(v);

function parsePositiveInt(v: string): number | null {
    if (!/^\d+$/.test(v)) return null;
    const n = parseInt(v, 10);
    return n > 0 ? n : null;
}

// End of the chosen local day (23:59:59 local) as UTC basic format.
function formatUntil(date: Date): string {
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
    return `${end.getUTCFullYear()}${pad(end.getUTCMonth() + 1)}${pad(end.getUTCDate())}` +
        `T${pad(end.getUTCHours())}${pad(end.getUTCMinutes())}${pad(end.getUTCSeconds())}Z`;
}

// UNTIL (date, floating local, or UTC Z form) → the last local calendar day
// that can hold an occurrence. Series splits write UNTIL = split − 1s, which
// lands on the split day but before the start's time-of-day, so the effective
// last day is the one before (otherwise a rebuild would resurrect it).
function parseUntil(v: string, start: Date): Date | null {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    if (mo > 11 || d < 1 || d > 31) return null;
    let instant: Date;
    if (m[4] === undefined) instant = new Date(y, mo, d);
    else if (m[7]) instant = new Date(Date.UTC(y, mo, d, Number(m[4]), Number(m[5]), Number(m[6])));
    else instant = new Date(y, mo, d, Number(m[4]), Number(m[5]), Number(m[6]));
    if (Number.isNaN(instant.getTime())) return null;
    const secondsOfDay = (d: Date) => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    const dayShift = m[4] !== undefined && secondsOfDay(instant) < secondsOfDay(start) ? -1 : 0;
    return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate() + dayShift);
}

// Backend rejects UNTIL more than 50 years past the start; stay a little inside.
export const maxUntilDate = (start: Date): Date =>
    new Date(start.getFullYear() + 50, start.getMonth(), start.getDate() - 2);

// Local day of the first occurrence (the backend snaps the series start to it).
// Only WEEKLY can begin after `start`: the first BYDAY on/after it, in a week
// (Monday-based, WKST=MO) that is a multiple of `interval` from start's week.
export function firstOccurrenceDay(rec: Recurrence, start: Date): Date | null {
    const day0 = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    if (rec.freq !== "WEEKLY") return day0;
    const startDow = (start.getDay() + 6) % 7; // Mon = 0
    for (let i = 0; i < 7 * rec.interval; i++) {
        const d = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + i);
        const week = Math.floor((startDow + i) / 7);
        if (week % rec.interval === 0 && rec.byday.includes(weekdayOf(d))) return d;
    }
    return null;
}

export function buildRrule(rec: Recurrence): string {
    const parts = [`FREQ=${rec.freq}`];
    if (rec.interval > 1) parts.push(`INTERVAL=${rec.interval}`);
    if (rec.freq === "WEEKLY" && rec.byday.length) parts.push(`BYDAY=${sortWeekdays(rec.byday).join(",")}`);
    if (rec.end.type === "until") parts.push(`UNTIL=${formatUntil(rec.end.date)}`);
    else if (rec.end.type === "count") parts.push(`COUNT=${rec.end.n}`);
    return parts.join(";");
}

// `start` is the event's (occurrence's) start: WEEKLY without BYDAY resolves to
// its weekday, and an explicit BYMONTHDAY / BYMONTH is only representable when
// it agrees with it (the picker always derives those from the start).
export function parseRrule(rrule: string, start: Date): Recurrence | null {
    const body = rrule.trim().replace(/^RRULE:/i, "");
    if (!body) return null;

    const fields = new Map<string, string>();
    for (const part of body.split(";")) {
        if (!part) continue;
        const eq = part.indexOf("=");
        if (eq <= 0) return null;
        const key = part.slice(0, eq).toUpperCase();
        if (!KNOWN_PARTS.has(key) || fields.has(key)) return null;
        fields.set(key, part.slice(eq + 1).toUpperCase());
    }

    const freq = fields.get("FREQ");
    if (!isFreq(freq)) return null;

    let interval = 1;
    const intervalStr = fields.get("INTERVAL");
    if (intervalStr !== undefined) {
        const n = parsePositiveInt(intervalStr);
        if (n === null) return null;
        interval = n;
    }

    let byday: Weekday[] = [];
    const bydayStr = fields.get("BYDAY");
    if (bydayStr !== undefined) {
        if (freq !== "WEEKLY") return null;
        const days = bydayStr.split(",");
        if (!days.length || !days.every(isWeekday)) return null;
        byday = sortWeekdays(days as Weekday[]);
    } else if (freq === "WEEKLY") {
        byday = [weekdayOf(start)];
    }

    const monthDay = fields.get("BYMONTHDAY");
    if (monthDay !== undefined) {
        if (freq !== "MONTHLY" && freq !== "YEARLY") return null;
        if (parsePositiveInt(monthDay) !== start.getDate()) return null;
    }
    const month = fields.get("BYMONTH");
    if (month !== undefined) {
        if (freq !== "YEARLY") return null;
        if (parsePositiveInt(month) !== start.getMonth() + 1) return null;
    }
    // WKST only changes results for multi-day, interval > 1 weekly rules; we
    // never emit it, so only the default is representable.
    const wkst = fields.get("WKST");
    if (wkst !== undefined && wkst !== "MO") return null;

    const untilStr = fields.get("UNTIL");
    const countStr = fields.get("COUNT");
    let end: RecurrenceEnd = { type: "never" };
    if (untilStr !== undefined && countStr !== undefined) return null;
    if (untilStr !== undefined) {
        const date = parseUntil(untilStr, start);
        if (!date) return null;
        end = { type: "until", date };
    } else if (countStr !== undefined) {
        const n = parsePositiveInt(countStr);
        if (n === null) return null;
        end = { type: "count", n };
    }

    return { freq, interval, byday, end };
}

// Whether two RRULE bodies describe the same recurrence for an event starting
// at `start` (part order, case, BYDAY order, UNTIL formatting don't matter).
// Rules the picker can't represent fall back to an exact string match.
export function sameRrule(a: string | null, b: string | null, start: Date): boolean {
    if (!a || !b) return !a && !b;
    if (a === b) return true;
    const ra = parseRrule(a, start);
    const rb = parseRrule(b, start);
    return !!ra && !!rb && buildRrule(ra) === buildRrule(rb);
}

export function presetRecurrence(preset: RepeatPreset, start: Date): Recurrence | null {
    const never: RecurrenceEnd = { type: "never" };
    switch (preset) {
        case "none": return null;
        case "daily": return { freq: "DAILY", interval: 1, byday: [], end: never };
        case "weekdays": return { freq: "WEEKLY", interval: 1, byday: [...WORKDAYS], end: never };
        case "weekly": return { freq: "WEEKLY", interval: 1, byday: [weekdayOf(start)], end: never };
        case "monthly": return { freq: "MONTHLY", interval: 1, byday: [], end: never };
        case "yearly": return { freq: "YEARLY", interval: 1, byday: [], end: never };
    }
}

// The preset a parsed rule is equivalent to (relative to `start`), if any.
export function matchPreset(rec: Recurrence, start: Date): RepeatPreset | null {
    if (rec.interval !== 1 || rec.end.type !== "never") return null;
    switch (rec.freq) {
        case "DAILY": return "daily";
        case "MONTHLY": return "monthly";
        case "YEARLY": return "yearly";
        case "WEEKLY":
            if (sameDays(rec.byday, WORKDAYS)) return "weekdays";
            if (sameDays(rec.byday, [weekdayOf(start)])) return "weekly";
            return null;
    }
}

const monthDayLabel = (d: Date): string => `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;

// RFC 5545 skips months/years where the day doesn't exist (no clamping).
const monthlySkipHint = (d: Date): string => d.getDate() >= 29 ? " (skips shorter months)" : "";
const yearlySkipHint = (d: Date): string => d.getMonth() === 1 && d.getDate() === 29 ? " (leap years only)" : "";

export function presetLabel(preset: RepeatPreset, start: Date): string {
    switch (preset) {
        case "none": return "Does not repeat";
        case "daily": return "Daily";
        case "weekdays": return "Every weekday (Mon–Fri)";
        case "weekly": return `Weekly on ${DAY_LONG[weekdayOf(start)]}`;
        case "monthly": return `Monthly on day ${start.getDate()}${monthlySkipHint(start)}`;
        case "yearly": return `Yearly on ${monthDayLabel(start)}${yearlySkipHint(start)}`;
    }
}

export function describeRecurrence(rec: Recurrence, start: Date): string {
    const n = rec.interval;
    let base: string;
    switch (rec.freq) {
        case "DAILY":
            base = n === 1 ? "Daily" : `Every ${n} days`;
            break;
        case "WEEKLY": {
            const days = rec.byday.length ? sortWeekdays(rec.byday) : [weekdayOf(start)];
            // One day spelled out, matching the preset label ("Weekly on Monday").
            const list = days.length === 1 ? DAY_LONG[days[0]] : days.map(d => DAY_SHORT[d]).join(", ");
            if (n === 1 && sameDays(days, WORKDAYS)) base = "Every weekday";
            else base = n === 1 ? `Weekly on ${list}` : `Every ${n} weeks on ${list}`;
            break;
        }
        case "MONTHLY":
            base = (n === 1 ? `Monthly on day ${start.getDate()}` : `Every ${n} months on day ${start.getDate()}`) +
                monthlySkipHint(start);
            break;
        case "YEARLY":
            base = (n === 1 ? `Yearly on ${monthDayLabel(start)}` : `Every ${n} years on ${monthDayLabel(start)}`) +
                yearlySkipHint(start);
            break;
    }
    if (rec.end.type === "until") {
        return `${base}, until ${monthDayLabel(rec.end.date)}, ${rec.end.date.getFullYear()}`;
    }
    if (rec.end.type === "count") {
        return `${base}, ${rec.end.n === 1 ? "once" : `${rec.end.n} times`}`;
    }
    return base;
}

export function describeRrule(rrule: string | null | undefined, start: Date): string {
    if (!rrule) return "Does not repeat";
    const rec = parseRrule(rrule, start);
    return rec ? describeRecurrence(rec, start) : "Custom rule";
}
