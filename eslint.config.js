import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import effect from "@effect/eslint-plugin"
import prettier from "eslint-config-prettier"

export default tseslint.config(
  { ignores: ["build/**", ".react-router/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    plugins: { "@effect": effect },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@effect/no-import-from-barrel-package": "warn",
    },
  },
  prettier,
)
