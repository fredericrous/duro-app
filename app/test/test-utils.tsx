import { render, type RenderOptions } from "@testing-library/react"
import { type ReactNode } from "react"
import i18next from "i18next"
import { DevToolbarContext } from "~/components/DevToolbar/DevToolbar"

/**
 * Resolve an i18n key through the bootstrapped i18next instance.
 *
 * Tests should assert against keys, not hand-typed English copy — the
 * translation file is the source of truth for what renders. Pass a default
 * value when the component uses the `t(key, "fallback")` form (keys whose
 * fallback isn't in the locale bundle yet).
 *
 *   expect(screen.getByText(t("admin.nav.applications", "Applications"))).toBeInTheDocument()
 *   expect(screen.getByPlaceholderText(t("noAccess.form.applicationPlaceholder"))).toBeInTheDocument()
 */
export const t = (key: string, defaultValue?: string, opts?: Record<string, unknown>): string =>
  i18next.t(key, { ...(defaultValue !== undefined ? { defaultValue } : null), ...opts }) as string

interface DevOverrides {
  certInstalled: boolean
}

export function TestDevProvider({
  children,
  overrides = { certInstalled: false },
}: {
  children: ReactNode
  overrides?: DevOverrides
}) {
  return <DevToolbarContext.Provider value={overrides}>{children}</DevToolbarContext.Provider>
}

export function renderWithDev(
  ui: React.ReactElement,
  { overrides, ...options }: RenderOptions & { overrides?: DevOverrides } = {},
) {
  return render(ui, {
    wrapper: ({ children }) => <TestDevProvider overrides={overrides}>{children}</TestDevProvider>,
    ...options,
  })
}
