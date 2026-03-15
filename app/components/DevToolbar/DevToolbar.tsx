import { createContext, useContext, useState, type ReactNode } from "react"
import { Switch } from "@duro-app/ui"
import { css, html } from "react-strict-dom"

interface DevOverrides {
  certInstalled: boolean
}

const DevToolbarContext = createContext<DevOverrides | null>(null)

export function useDevOverrides(): DevOverrides | null {
  return useContext(DevToolbarContext)
}

const styles = css.create({
  toolbar: {
    position: "fixed",
    bottom: 16,
    right: 16,
    zIndex: 9999,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "rgba(30, 30, 30, 0.95)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "rgba(255, 255, 255, 0.1)",
    backdropFilter: "blur(8px)",
    fontSize: 12,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "#fbbf24",
    fontWeight: 600,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
})

export function DevToolbar({ children }: { children: ReactNode }) {
  const [certInstalled, setCertInstalled] = useState(false)

  return (
    <DevToolbarContext.Provider value={{ certInstalled }}>
      {children}
      <html.div style={styles.toolbar}>
        <html.div style={styles.header}>DEV</html.div>
        <Switch checked={certInstalled} onCheckedChange={setCertInstalled}>
          Certificate
        </Switch>
      </html.div>
    </DevToolbarContext.Provider>
  )
}
