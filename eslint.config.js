import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import effect from "@effect/eslint-plugin"
import duro from "@duro-app/eslint-plugin"
import prettier from "eslint-config-prettier"

export default tseslint.config(
  { ignores: ["build/**", ".react-router/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    plugins: { "@effect": effect },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@effect/no-import-from-barrel-package": "warn",
    },
  },
  {
    ...duro.configs.recommended,
    files: ["app/**/*.{ts,tsx}"],
    // Tests render throwaway DOM fixtures and route/component mocks; email
    // templates are @react-email/@duro-app/ui-email, where react-strict-dom
    // does not run at all. Neither ships design-system UI.
    ignores: ["app/**/*.test.{ts,tsx}", "app/lib/emails/**"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...duro.configs.recommended.rules,
      "duro/no-raw-html-element": [
        "error",
        {
          allow: [
            // Document shell (root.tsx) — react-strict-dom models the page
            // body, never the document itself.
            "html",
            "head",
            "body",
            "meta",
            "link",
            "title",
            "script",
            // Native semantics with no rsd primitive: the disclosure pair
            // (HelpPopover) and the drawing surface (ScratchCard).
            "details",
            "summary",
            "canvas",
          ],
        },
      ],
    },
  },
  prettier,
)
