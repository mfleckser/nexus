import { describe, expect, it } from "vitest";
import { parseSnapshot, serializeSnapshot, SNAPSHOT_VERSION, type Snapshot } from "./snapshot";

const snapshot: Snapshot = {
    version: SNAPSHOT_VERSION,
    fetchedAt: "2026-11-19T18:00:00.000Z",
    tasks: [],
    events: [],
    hiddenProjectIds: ["p1"],
};

describe("parseSnapshot", () => {
    it("round-trips a snapshot", () => {
        expect(parseSnapshot(serializeSnapshot(snapshot))).toEqual(snapshot);
    });

    it("ignores missing, broken and other-version snapshots", () => {
        expect(parseSnapshot(null)).toBeNull();
        expect(parseSnapshot("{not json")).toBeNull();
        expect(parseSnapshot(JSON.stringify({ ...snapshot, version: 0 }))).toBeNull();
        expect(parseSnapshot(JSON.stringify({ ...snapshot, tasks: undefined }))).toBeNull();
        expect(parseSnapshot("null")).toBeNull();
    });
});
