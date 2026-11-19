import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";

export default defineConfig(
    { ignores: ["**/node_modules", ".expo", "dist", "web-build"] },
    tseslint.configs.recommended,
    {
        files: ["**/*.{ts,tsx}"],
        plugins: { "react-hooks": eslintPluginReactHooks },
        rules: eslintPluginReactHooks.configs.recommended.rules,
    },
);
