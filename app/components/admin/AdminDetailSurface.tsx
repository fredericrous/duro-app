import { createContext, useContext, type ReactNode } from "react"
import { DetailPanel, Drawer } from "@duro-app/ui"

/**
 * Where admin's side content renders: a non-modal DetailPanel beside the page
 * on wide screens, a modal Drawer from the right on narrow ones (the design
 * system's "mobile slide-in panels — compose with Drawer").
 *
 * The content node is built by a child route and stored in the layout's state,
 * so it cannot know the width it will render at. It reads the container from
 * this context instead, at render time: a resize across the breakpoint while
 * the panel is open re-renders the same node with the other container's parts.
 */
type Surface = "panel" | "drawer"

const SurfaceContext = createContext<Surface>("panel")

export function AdminDetailSurface({
  isWide,
  open,
  onOpenChange,
  label,
  children,
}: {
  isWide: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Accessible name of the wide panel's landmark (the Drawer takes its Title). */
  label: string
  children: ReactNode
}) {
  if (isWide) {
    return (
      <DetailPanel.Root open={open} onOpenChange={onOpenChange}>
        <DetailPanel.Content size="md" label={label}>
          <SurfaceContext.Provider value="panel">{children}</SurfaceContext.Provider>
        </DetailPanel.Content>
      </DetailPanel.Root>
    )
  }
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} anchor="right">
      <Drawer.Portal size="md">
        <SurfaceContext.Provider value="drawer">{children}</SurfaceContext.Provider>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

const useSurface = () => useContext(SurfaceContext)

/** The container's parts, picked by the surface the content renders in. */
export const DetailSurface = {
  Header: ({ children }: { children: ReactNode }) =>
    useSurface() === "panel" ? (
      <DetailPanel.Header>{children}</DetailPanel.Header>
    ) : (
      <Drawer.Header>{children}</Drawer.Header>
    ),
  Title: ({ children }: { children: ReactNode }) =>
    useSurface() === "panel" ? (
      <DetailPanel.Title>{children}</DetailPanel.Title>
    ) : (
      <Drawer.Title>{children}</Drawer.Title>
    ),
  Close: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) =>
    useSurface() === "panel" ? <DetailPanel.Close aria-label={ariaLabel} /> : <Drawer.Close aria-label={ariaLabel} />,
  /** `padded={false}` lets a list run edge to edge in the panel; the Drawer body keeps its own padding. */
  Body: ({ children, padded }: { children: ReactNode; padded?: boolean }) =>
    useSurface() === "panel" ? (
      <DetailPanel.Body padded={padded}>{children}</DetailPanel.Body>
    ) : (
      <Drawer.Body>{children}</Drawer.Body>
    ),
  Footer: ({ children }: { children: ReactNode }) =>
    useSurface() === "panel" ? (
      <DetailPanel.Footer>{children}</DetailPanel.Footer>
    ) : (
      <Drawer.Footer>{children}</Drawer.Footer>
    ),
}
