import { react, effect, tests } from "@duro-app/eslint-config"

export default [
  { ignores: ["build/**", ".react-router/**"] },
  // Shared duro-stack presets: base TS conventions + react-hooks + the duro
  // plugin + UI-library policy (react), Effect server policy (effect), and
  // accessibility-first test selectors (tests, self-scoped to test files).
  ...react,
  ...effect,
  ...tests,
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
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
  {
    // Tests render throwaway DOM fixtures and route/component mocks; email
    // templates are @react-email/@duro-app/ui-email, where react-strict-dom
    // does not run at all. Neither ships design-system UI, so the duro
    // rules don't apply (the import policy above still does).
    files: ["app/**/*.test.{ts,tsx}", "app/lib/emails/**"],
    rules: {
      "duro/no-raw-html-element": "off",
      "duro/prefer-ds-form-components": "off",
      "duro/no-deprecated-table-parts": "off",
      "duro/no-raw-design-values": "off",
      "duro/no-flex-grow-web": "off",
      "duro/no-tokens-barrel-import": "off",
    },
  },
]
