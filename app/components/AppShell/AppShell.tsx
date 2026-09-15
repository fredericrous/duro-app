import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useLocation } from "react-router"
import { css, html } from "react-strict-dom"
import { Button, Drawer, Grid, PageShell } from "@duro-app/ui"
import { breakpoints } from "@duro-app/tokens/tokens/breakpoints.css"

/**
 * The page shell shared by /settings and /admin: a navigation rail beside
 * the routed content, on the design system's `Grid layout="split-wide"`
 * (recipe page-with-sidenav — docs/mockups/app-shell, direction B).
 *
 * Wide (≥ md): rail + content side by side; the split collapses on the
 * width of its own container, so an open DetailPanel stacks it gracefully.
 * Narrow: the rail is hidden by CSS and a Menu button opens the same nav in
 * a left Drawer, switched on the same container width the split measures.
 * The only JavaScript here is the drawer's open state — no media query, so
 * the server and the first client paint agree.
 */

export interface AppShellNavProps {
  /**
   * Call after ANY selection, the current destination included: a route
   * change alone would leave the drawer open when the user re-picks where
   * they already are.
   */
  onSelect: () => void
}

interface AppShellProps {
  /** The page header; the route owns the loader data it needs. */
  header: ReactNode
  /** Builds the `SideNav.Root`; rendered in the rail and, while open, in the drawer. */
  nav: (props: AppShellNavProps) => ReactNode
  /** Drawer title, e.g. "Navigation". */
  navTitle: string
  /** The narrow-screen button that opens the drawer, e.g. "Menu". */
  menuLabel: string
  /** Accessible label of the drawer's close button. */
  closeLabel: string
  /** Routed content. */
  children: ReactNode
  /** Rendered beside the page, outside it — admin's DetailPanel pushes the page left. */
  aside?: ReactNode
}

const styles = css.create({
  outerFlex: {
    display: "flex",
    minHeight: 0,
    flex: 1,
  },
  pageWrap: {
    flex: 1,
    minWidth: 0,
    maxWidth: "100%",
    overflowX: "clip",
  },
  // Rail and Menu button switch on the SAME width the Grid split measures —
  // its container, not the viewport. A viewport query here would show the
  // rail at 768–816px while the split, measuring the page minus its padding,
  // had already stacked it above the content.
  shell: {
    containerType: "inline-size",
  },
  rail: {
    display: {
      default: "none",
      [`@container (min-width: ${breakpoints.md})`]: "block",
    },
  },
  menuBar: {
    display: {
      default: "flex",
      [`@container (min-width: ${breakpoints.md})`]: "none",
    },
    alignItems: "center",
  },
  main: {
    minWidth: 0,
  },
})

export function AppShell({ header, nav, navTitle, menuLabel, closeLabel, children, aside }: AppShellProps) {
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  // Belt and braces: a navigation that bypasses the nav's own onSelect
  // (a link inside the content, the browser's back button) closes it too.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  return (
    <html.div style={styles.outerFlex}>
      <html.div style={styles.pageWrap}>
        <PageShell maxWidth="lg" header={header}>
          <html.div style={styles.shell}>
            <html.div style={styles.menuBar}>
              <Button variant="secondary" size="small" onClick={() => setDrawerOpen(true)}>
                {menuLabel}
              </Button>
            </html.div>
            <Grid layout="split-wide" gap="xl">
              <html.div style={styles.rail}>{nav({ onSelect: closeDrawer })}</html.div>
              <html.div style={styles.main}>{children}</html.div>
            </Grid>
          </html.div>
        </PageShell>
      </html.div>

      <Drawer.Root open={drawerOpen} onOpenChange={setDrawerOpen} anchor="left">
        <Drawer.Portal size="sm">
          <Drawer.Header>
            <Drawer.Title>{navTitle}</Drawer.Title>
            <Drawer.Close aria-label={closeLabel} />
          </Drawer.Header>
          <Drawer.Body>{nav({ onSelect: closeDrawer })}</Drawer.Body>
        </Drawer.Portal>
      </Drawer.Root>

      {aside}
    </html.div>
  )
}
