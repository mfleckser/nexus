import { defineConfig } from "vitest/config";

// Fixed zone with DST transitions (2026-03-08 and 2026-11-01) so local-time
// results are deterministic on any machine. Workers inherit it.
process.env.TZ = "America/Los_Angeles";

export default defineConfig({
    test: {
        include: ["src/renderer/src/lib/**/*.test.ts"],
        environment: "node",
    },
});
