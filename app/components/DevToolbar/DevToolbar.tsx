import { createContext, useContext, useState, type ReactNode } from "react"
import { ActionBar, Switch } from "@duro-app/ui"

interface DevOverrides {
  certInstalled: boolean
}

export const DevToolbarContext = createContext<DevOverrides | null>(null)

export function useDevOverrides(): DevOverrides | null {
  return useContext(DevToolbarContext)
}

export function DevToolbar({ children }: { children: ReactNode }) {
  const [certInstalled, setCertInstalled] = useState(false)

  return (
    <DevToolbarContext.Provider value={{ certInstalled }}>
      {children}
      <ActionBar selectedItemCount={1} selectedLabel={() => "DEV"} onClearSelection={() => {}} dismissible={false}>
        <Switch checked={certInstalled} onCheckedChange={setCertInstalled}>
          Certificate
        </Switch>
      </ActionBar>
    </DevToolbarContext.Provider>
  )
}
