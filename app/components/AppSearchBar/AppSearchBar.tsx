import { useRef } from "react"
import { Icon, Input, InputGroup, Stack, Toggle, ToggleGroup } from "@duro-app/ui"
import { css, html } from "react-strict-dom"

const styles = css.create({
  // Inline SVG wrapper for the leading magnifier — the DS Icon catalog only
  // ships status icons (info, alert, x-circle, …), not glyphs like "search".
  // We keep this local rather than expanding the DS for a single use site.
  searchGlyph: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 16,
    color: "currentColor",
  },
  chipCount: {
    // Muted suffix (e.g. "Media · 8") so the count never competes with the
    // label for the user's eye but is still readable at a glance.
    opacity: 0.6,
    marginLeft: 4,
    fontVariantNumeric: "tabular-nums",
  },
  // CSS visually-hidden — content readable by screen readers, invisible on
  // screen. DS doesn't ship a primitive for this, so inline it here.
  visuallyHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
})

interface SearchChip {
  value: string
  label: string
  /** Optional count rendered as a muted "· N" suffix after the label. */
  count?: number
}

interface AppSearchBarProps {
  query: string
  onQueryChange: (next: string) => void
  chips: ReadonlyArray<SearchChip>
  selected: ReadonlyArray<string>
  onSelectedChange: (next: string[]) => void
  placeholder: string
  /** Translated aria-label for the clear button. */
  clearLabel: string
}

export function AppSearchBar({
  query,
  onQueryChange,
  chips,
  selected,
  onSelectedChange,
  placeholder,
  clearLabel,
}: AppSearchBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const hasQuery = query.length > 0

  return (
    <Stack gap="sm">
      <InputGroup.Root>
        <InputGroup.Addon position="start">
          <html.span style={styles.searchGlyph}>
            <SearchGlyph />
          </html.span>
        </InputGroup.Addon>
        <Input
          ref={inputRef}
          type="search"
          placeholder={placeholder}
          value={query}
          autoComplete="off"
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {hasQuery && (
          <InputGroup.Addon
            position="end"
            onClick={() => {
              onQueryChange("")
              inputRef.current?.focus()
            }}
          >
            <Icon name="x-circle" size={16} />
            <html.span style={styles.visuallyHidden}>{clearLabel}</html.span>
          </InputGroup.Addon>
        )}
      </InputGroup.Root>

      {chips.length > 0 && (
        <ToggleGroup multiple size="small" value={selected as string[]} onValueChange={onSelectedChange}>
          {chips.map((chip) => (
            <Toggle key={chip.value} value={chip.value} aria-label={chip.label}>
              {chip.label}
              {typeof chip.count === "number" && <html.span style={styles.chipCount}>{` · ${chip.count}`}</html.span>}
            </Toggle>
          ))}
        </ToggleGroup>
      )}
    </Stack>
  )
}

/** Lucide-style search icon, inlined to avoid expanding the DS icon catalog. */
function SearchGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

/**
 * Skeleton placeholder for Suspense fallbacks: keeps page layout stable
 * before the apps promise resolves. Shape matches the real bar (input row +
 * chip row) so there's no visual jump on hydration.
 */
const skeletonStyles = css.create({
  input: {
    height: 36,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chip: {
    height: 28,
    width: 92,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipRow: {
    display: "flex",
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
})

export function AppSearchBarSkeleton() {
  return (
    <Stack gap="sm">
      <html.div style={skeletonStyles.input} aria-hidden={true} />
      <html.div style={skeletonStyles.chipRow} aria-hidden={true}>
        <html.div style={skeletonStyles.chip} />
        <html.div style={skeletonStyles.chip} />
        <html.div style={skeletonStyles.chip} />
      </html.div>
    </Stack>
  )
}
