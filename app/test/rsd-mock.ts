/**
 * Mock for react-strict-dom in Vitest.
 * StyleX requires Babel compilation which Vitest (via Vite) doesn't provide.
 * This mock returns identity-passthrough objects for css.create() and
 * forwards html.* elements to their native HTML equivalents.
 */
import { vi } from "vitest"
import React from "react"

// css.create() returns a proxy that passes style objects through as-is
const cssCreate = (styles: Record<string, any>) => {
  const result: Record<string, any> = {}
  for (const key in styles) {
    result[key] = typeof styles[key] === "function" ? styles[key] : styles[key]
  }
  return result
}

// html.* elements forward to native HTML elements
const htmlHandler: ProxyHandler<any> = {
  get(_target, prop: string) {
    return React.forwardRef((props: any, ref: any) => {
      const { style: _style, ...rest } = props
      return React.createElement(prop, { ...rest, ref })
    })
  },
}

vi.mock("react-strict-dom", () => ({
  css: {
    create: cssCreate,
    defineVars: (vars: any) => vars,
    createTheme: (vars: any, theme: any) => theme,
    defineConsts: (consts: any) => consts,
    firstThatWorks: (...args: any[]) => args[0],
  },
  html: new Proxy({}, htmlHandler),
}))
