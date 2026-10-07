import { useRef } from "react"
import { Icon, Input, InputGroup, Stack, Toggle, ToggleGroup } from "@duro-app/ui"
import { css, html } from "react-strict-dom"
import { sizes } from "@duro-app/tokens/tokens/sizes.css"
import { colors } from "@duro-app/tokens/tokens/colors.css"
import { radii, spacing } from "@duro-app/tokens/tokens/spacing.css"

const styles = css.create({
  chipCount: {
    // Muted suffix (e.g. "Media · 8") so the count never competes with the
    // label for the user's eye but is still readable at a glance.
    opacity: 0.6,
    marginLeft: spacing.xs,
    fontVariantNumeric: "tabular-nums",
  },
  // CSS visually-hidden — content readable by screen readers, invisible on
  // screen. DS doesn't ship a primitive for this, so inline it here.
  visuallyHidden: {
    position: "absolute",
    width: sizes.divider,
    height: sizes.divider,
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
          <Icon name="search" size="sm" />
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
            <Icon name="x-circle" size="sm" />
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

/**
 * Skeleton placeholder for Suspense fallbacks: keeps page layout stable
 * before the apps promise resolves. Shape matches the real bar (input row +
 * chip row) so there's no visual jump on hydration.
 */
const skeletonStyles = css.create({
  input: {
    height: sizes.controlMd,
    borderRadius: radii.sm,
    backgroundColor: colors.bgCard,
  },
  chip: {
    height: sizes.controlSm,
    width: "5.75rem",
    borderRadius: radii.full,
    backgroundColor: colors.bgCard,
  },
  chipRow: {
    display: "flex",
    flexDirection: "row",
    gap: spacing.sm,
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
