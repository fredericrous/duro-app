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

// html.* elements forward to native HTML elements.
//
// The component per tag is created ONCE and cached. Minting a fresh
// forwardRef on every property access would hand React a new element *type*
// on every render, which it can only reconcile by unmounting the old subtree
// and mounting a new one — so any re-render of a component using html.*
// silently remounts its whole subtree, resetting child state. On a page whose
// subtree registers a router fetcher, that remount loop never terminates: the
// new fetcher updates router state, which re-renders, which remounts again.
const htmlComponents = new Map<string, React.ElementType>()
const htmlHandler: ProxyHandler<any> = {
  get(_target, prop: string) {
    const cached = htmlComponents.get(prop)
    if (cached) return cached
    const component = React.forwardRef((props: any, ref: any) => {
      const { style: _style, ...rest } = props
      return React.createElement(prop, { ...rest, ref })
    })
    component.displayName = `html.${prop}`
    htmlComponents.set(prop, component)
    return component
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
