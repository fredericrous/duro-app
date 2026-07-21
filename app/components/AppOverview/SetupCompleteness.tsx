import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { css, html } from "react-strict-dom"
import { Button, Heading, Icon, Inline, Panel, Stack, Text } from "@duro-app/ui"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { colors } from "@duro-app/tokens/tokens/colors.css"
import { duration, easing } from "@duro-app/tokens/tokens/motion.css"
import { useReducedMotion } from "~/lib/useReducedMotion"
import { AnimatedNumber } from "~/components/motion/AnimatedNumber"

export interface SetupCriterion {
  /** stable id, maps to admin.applications.setup.criteria.<id> / .fix.<id> */
  id: string
  done: boolean
  onFix: () => void
}

interface SetupCompletenessProps {
  criteria: ReadonlyArray<SetupCriterion>
  /**
   * i18n key prefix for this checklist's copy. Resolves `<prefix>.title`,
   * `.progress`, `.complete`, `.criteria.<id>`, `.fix.<id>`. Defaults to the
   * per-application namespace so existing callers are unaffected; the first-run
   * checklist passes its own prefix to reuse this same machinery.
   */
  i18nPrefix?: string
}

/**
 * A guided, rewarding "completion checklist" meter: a segmented progress bar
 * fills as each criterion is satisfied, and each unmet criterion offers a
 * one-click jump to where it's fixed. Reused for per-application setup and for
 * the admin first-run path via `i18nPrefix`. Animation respects
 * prefers-reduced-motion.
 */
export function SetupCompleteness({ criteria, i18nPrefix = "admin.applications.setup" }: SetupCompletenessProps) {
  const { t } = useTranslation()
  const reduced = useReducedMotion()
  const done = criteria.filter((c) => c.done).length
  const total = criteria.length
  const complete = done === total

  // One-shot "pop" when the meter flips to complete in place (e.g. granting the
  // last criterion via the QuickGrant dialog, which keeps this mounted). Not on
  // first mount of an already-complete app, and skipped under reduced motion.
  const wasComplete = useRef(complete)
  const [entering, setEntering] = useState(false)
  useEffect(() => {
    if (!wasComplete.current && complete && !reduced) {
      setEntering(true)
      const raf = requestAnimationFrame(() => setEntering(false))
      wasComplete.current = complete
      return () => cancelAnimationFrame(raf)
    }
    wasComplete.current = complete
  }, [complete, reduced])

  return (
    <Panel.Root bordered>
      <Panel.Header>
        <Inline justify="between" align="center">
          <Heading level={4}>{t(`${i18nPrefix}.title`)}</Heading>
          <Text color="muted" variant="caption">
            <AnimatedNumber value={done} /> {t(`${i18nPrefix}.progress`, { total })}
          </Text>
        </Inline>
      </Panel.Header>
      <Panel.Body>
        <Stack gap="md">
          <html.div
            role="progressbar"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label={t(`${i18nPrefix}.title`)}
            style={[styles.track, styles.trackCols(total)]}
          >
            {criteria.map((c, i) => (
              <html.div key={c.id} style={[styles.segment, i < done && styles.segmentFilled]} />
            ))}
          </html.div>

          {complete ? (
            <html.div style={[styles.completeBanner, entering && styles.completeBannerEnter]}>
              <Inline gap="sm" align="center">
                <html.span style={[styles.statusIcon, styles.iconSuccess]}>
                  <Icon name="check-circle" size={20} />
                </html.span>
                <Text>{t(`${i18nPrefix}.complete`)}</Text>
              </Inline>
            </html.div>
          ) : (
            <Stack gap="sm">
              {criteria.map((c) => (
                <Inline key={c.id} justify="between" align="center">
                  <Inline gap="sm" align="center">
                    <html.span style={[styles.statusIcon, c.done ? styles.iconSuccess : styles.iconMuted]}>
                      <Icon name={c.done ? "check-circle" : "clock"} size={18} />
                    </html.span>
                    <Text color={c.done ? "muted" : undefined}>{t(`${i18nPrefix}.criteria.${c.id}`)}</Text>
                  </Inline>
                  {!c.done && (
                    <Button variant="secondary" size="small" onClick={c.onFix}>
                      {t(`${i18nPrefix}.fix.${c.id}`)}
                    </Button>
                  )}
                </Inline>
              ))}
            </Stack>
          )}
        </Stack>
      </Panel.Body>
    </Panel.Root>
  )
}

const styles = css.create({
  // Margin-less colored icon wrapper — StatusIcon carries a bottom margin (for
  // the hero/empty-state layout) that pushes it off-center when used inline.
  statusIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  iconSuccess: {
    color: colors.success,
  },
  iconMuted: {
    color: colors.textMuted,
  },
  track: {
    display: "grid",
    gap: spacing.xs,
  },
  // One equal column per criterion — derived from the count rather than a fixed
  // 5, so the bar stays correct if the criteria list ever changes.
  trackCols: (cols: number) => ({
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
  }),
  segment: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "var(--color-border)",
    transitionProperty: "background-color",
    transitionDuration: {
      default: duration.slow,
      "@media (prefers-reduced-motion: reduce)": duration.instant,
    },
    transitionTimingFunction: easing.standard,
  },
  segmentFilled: {
    backgroundColor: "var(--color-accent)",
  },
  completeBanner: {
    transformOrigin: "left center",
    transform: "scale(1)",
    opacity: 1,
    transitionProperty: "transform, opacity",
    transitionDuration: {
      default: duration.slow,
      "@media (prefers-reduced-motion: reduce)": duration.instant,
    },
    transitionTimingFunction: easing.easeOut,
  },
  // Starting frame of the one-shot completion pop; cleared on the next frame so
  // the banner transitions up to its resting scale/opacity.
  completeBannerEnter: {
    transform: "scale(0.92)",
    opacity: 0,
  },
})
