import { readFileSync } from "node:fs";
import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript";
import { describe, expect, it } from "vitest";

describe("schema.d.ts", () => {
    it("matches backend/openapi.json (regenerate with `npm run generate`)", async () => {
        const ast = await openapiTS(new URL("../../../backend/openapi.json", import.meta.url));
        const committed = readFileSync(new URL("./schema.d.ts", import.meta.url), "utf8");
        expect(COMMENT_HEADER + astToString(ast)).toBe(committed);
    });
});
