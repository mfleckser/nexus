import { describe, expect, it } from "vitest";
import { edgeVelocity } from "./autoScroll";

const tuning = { zonePx: 80, delayMs: 250, minSpeed: 2, maxSpeed: 20, overshootPx: 32 };

describe("edgeVelocity", () => {
    it("is zero away from both edges", () => {
        expect(edgeVelocity(300, 0, 600, tuning)).toBe(0);
        // The zone's inner boundary itself is outside the zone.
        expect(edgeVelocity(80, 0, 600, tuning)).toBe(0);
        expect(edgeVelocity(520, 0, 600, tuning)).toBe(0);
    });

    it("scrolls toward the end near the end, ramping linearly", () => {
        expect(edgeVelocity(521, 0, 600, tuning)).toBeCloseTo(2 + 18 * (1 / 80));
        expect(edgeVelocity(560, 0, 600, tuning)).toBeCloseTo(11);
        expect(edgeVelocity(600, 0, 600, tuning)).toBe(20);
    });

    it("scrolls toward the start near the start", () => {
        expect(edgeVelocity(140, 100, 700, tuning)).toBeCloseTo(-11);
        expect(edgeVelocity(100, 100, 700, tuning)).toBe(-20);
    });

    it("caps at max speed just past either edge", () => {
        expect(edgeVelocity(630, 0, 600, tuning)).toBe(20);
        expect(edgeVelocity(-30, 0, 600, tuning)).toBe(-20);
    });

    it("ignores a pointer well past the edge", () => {
        expect(edgeVelocity(633, 0, 600, tuning)).toBe(0);
        expect(edgeVelocity(-200, 0, 600, tuning)).toBe(0);
    });

    it("uses the nearer edge when the zones overlap", () => {
        expect(edgeVelocity(40, 0, 100, tuning)).toBeLessThan(0);
        expect(edgeVelocity(60, 0, 100, tuning)).toBeGreaterThan(0);
    });
});
