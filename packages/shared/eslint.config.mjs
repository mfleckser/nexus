import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig({ ignores: ["**/node_modules"] }, tseslint.configs.recommended, {
    rules: {
        // Shared with clients that aren't Electron (mobile).
        "no-restricted-imports": ["error", { paths: ["electron"], patterns: ["electron/*", "@electron-toolkit/*"] }],
    },
});
