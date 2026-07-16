import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { css, html } from "react-strict-dom"
import { Button, Heading, Inline, Panel, Stack, StatusIcon, Text } from "@duro-app/ui"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
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
}

/**
 * Per-application "setup completeness" meter. Turns the flat governance CRUD
 * surface into a guided, rewarding checklist: a segmented progress bar fills as
 * each criterion is satisfied, and each unmet criterion offers a one-click jump
 * to where it's fixed. The bar animation respects prefers-reduced-motion.
 */
export function SetupCompleteness({ criteria }: SetupCompletenessProps) {
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
          <Heading level={4}>{t("admin.applications.setup.title")}</Heading>
          <Text color="muted" variant="caption">
            <AnimatedNumber value={done} /> {t("admin.applications.setup.progress", { total })}
          </Text>
        </Inline>
      </Panel.Header>
      <Panel.Body>
        <Stack gap="md">
          <html.div style={styles.track}>
            {criteria.map((c, i) => (
              <html.div key={c.id} style={[styles.segment, i < done && styles.segmentFilled]} />
            ))}
          </html.div>

          {complete ? (
            <html.div style={[styles.completeBanner, entering && styles.completeBannerEnter]}>
              <Inline gap="sm" align="center">
                <StatusIcon name="check-circle" variant="success" size={20} />
                <Text>{t("admin.applications.setup.complete")}</Text>
              </Inline>
            </html.div>
          ) : (
            <Stack gap="sm">
              {criteria.map((c) => (
                <Inline key={c.id} justify="between" align="center">
                  <Inline gap="sm" align="center">
                    <StatusIcon
                      name={c.done ? "check-circle" : "clock"}
                      variant={c.done ? "success" : "muted"}
                      size={18}
                    />
                    <Text color={c.done ? "muted" : undefined}>{t(`admin.applications.setup.criteria.${c.id}`)}</Text>
                  </Inline>
                  {!c.done && (
                    <Button variant="secondary" size="small" onClick={c.onFix}>
                      {t(`admin.applications.setup.fix.${c.id}`)}
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
  // Fixed 5 columns: matches the five governance criteria fed by AppOverview.
  track: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: spacing.xs,
  },
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
