import { react } from "@greenharness/greenrack-eslint-config"
import { effect, tests, adrLint } from "@aval-adr/eslint-config"

export default [
  { ignores: ["build/**", ".react-router/**"] },
  // react (greenrack): base TS conventions + react-hooks + the greenrack plugin +
  // UI-library policy. effect and tests (@aval-adr/eslint-config): Effect
  // server policy and accessibility-first test selectors (self-scoped).
  ...react,
  ...effect,
  ...tests,
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "greenrack/no-raw-html-element": [
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
    // templates are built with @react-email and @greenharness/greenrack-ui-email, where react-strict-dom
    // does not run at all. Neither ships design-system UI, so the greenrack
    // rules don't apply (the import policy above still does).
    files: ["app/**/*.test.{ts,tsx}", "app/lib/emails/**"],
    rules: {
      "greenrack/no-raw-html-element": "off",
      "greenrack/prefer-ds-form-components": "off",
      "greenrack/no-deprecated-table-parts": "off",
      "greenrack/no-raw-design-values": "off",
      "greenrack/no-flex-grow-web": "off",
      "greenrack/no-tokens-barrel-import": "off",
    },
  },
  ...adrLint(),
]
