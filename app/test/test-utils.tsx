import { render, type RenderOptions } from "@testing-library/react"
import { type ReactNode } from "react"
import { DevToolbarContext } from "~/components/DevToolbar/DevToolbar"

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
  return (
    <DevToolbarContext.Provider value={overrides}>
      {children}
    </DevToolbarContext.Provider>
  )
}

export function renderWithDev(
  ui: React.ReactElement,
  { overrides, ...options }: RenderOptions & { overrides?: DevOverrides } = {},
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <TestDevProvider overrides={overrides}>{children}</TestDevProvider>
    ),
    ...options,
  })
}
