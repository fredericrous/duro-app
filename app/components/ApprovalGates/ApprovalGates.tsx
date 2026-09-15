import { Fragment, useEffect, useMemo, useState } from "react"
import { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import { css, html } from "react-strict-dom"
import { colors } from "@duro-app/tokens/tokens/colors.css"
import { spacing, radii } from "@duro-app/tokens/tokens/spacing.css"
import { typography } from "@duro-app/tokens/tokens/typography.css"
import { duration, easing } from "@duro-app/tokens/tokens/motion.css"
import {
  Badge,
  Button,
  Callout,
  Cluster,
  Icon,
  Inline,
  List,
  Stack,
  Tag,
  Text,
  Toggle,
  ToggleGroup,
} from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { useFetcherToast } from "~/lib/useFetcherToast"
import { useReducedMotion } from "~/lib/useReducedMotion"
import {
  APPLICATION_SCOPE,
  effectiveGate,
  sameApprover,
  sameRules,
  scopeKey,
  type EffectiveGate,
  type GateScope,
} from "~/lib/governance/approval-gates"
import type {
  ApprovalMode,
  ApprovalPolicy,
  ApprovalPolicyRule,
  Application,
  Entitlement,
  Principal,
  Role,
} from "~/lib/governance/types"

// ---------------------------------------------------------------------------
// Approval gate board — the "loadout screen" for who approves a request.
//
// Left: every scope a request can land on (the whole app, each role, each
// entitlement) with what guards it today. Right: the selected scope's gates
// as a track — Request → gate, gate, … → Granted — plus the roster of people
// who can be slotted in, and a "Try it" line that narrates the outcome.
//
// Inheritance is explicit: a scope without its own policy shows the whole-app
// gate greyed and any edit promotes it to its own gate. No policy anywhere is
// the dangerous state (the workflow auto-approves), so it is never blank.
// ---------------------------------------------------------------------------

interface ApprovalGatesProps {
  application: Application
  roles: Role[]
  entitlements: Entitlement[]
  principals: Principal[]
  policies: ApprovalPolicy[]
}

interface ScopeRow {
  scope: GateScope
  key: string
  label: string
  gate: EffectiveGate
}

const OWNER_RULE: ApprovalPolicyRule = { approverType: "app_owner" }

export function ApprovalGates({ application, roles, entitlements, principals, policies }: ApprovalGatesProps) {
  const { t } = useTranslation()
  const [selectedKey, setSelectedKey] = useState<string>(scopeKey(APPLICATION_SCOPE))

  const rows = useMemo<ScopeRow[]>(() => {
    const mk = (scope: GateScope, label: string): ScopeRow => ({
      scope,
      key: scopeKey(scope),
      label,
      gate: effectiveGate(policies, scope),
    })
    return [
      mk(APPLICATION_SCOPE, t("admin.applications.gates.wholeApp")),
      ...roles.map((r) => mk({ type: "role", id: r.id }, r.displayName)),
      ...entitlements.map((e) => mk({ type: "entitlement", id: e.id }, e.displayName)),
    ]
  }, [policies, roles, entitlements, t])

  const selected = rows.find((r) => r.key === selectedKey) ?? rows[0]
  const owner = application.ownerId ? (principals.find((p) => p.id === application.ownerId) ?? null) : null
  const people = useMemo(() => principals.filter((p) => p.principalType === "user" && p.enabled), [principals])

  const roleRows = rows.filter((r) => r.scope.type === "role")
  const entitlementRows = rows.filter((r) => r.scope.type === "entitlement")
  const policyVersion = policies.map((p) => `${p.id}@${p.updatedAt}`).join("|")

  return (
    <html.div style={styles.board}>
      <CardSection title={t("admin.applications.gates.scopesTitle")}>
        <List.Root selectionMode="single" aria-label={t("admin.applications.gates.scopesLabel")}>
          <ScopeItem
            row={rows[0]}
            selected={rows[0].key === selected.key}
            onSelect={setSelectedKey}
            hint={t("admin.applications.gates.wholeAppHint")}
          />
          {roleRows.length > 0 && <ScopeGroupLabel>{t("admin.applications.gates.roles")}</ScopeGroupLabel>}
          {roleRows.map((row) => (
            <ScopeItem key={row.key} row={row} selected={row.key === selected.key} onSelect={setSelectedKey} />
          ))}
          {entitlementRows.length > 0 && (
            <ScopeGroupLabel>{t("admin.applications.gates.entitlements")}</ScopeGroupLabel>
          )}
          {entitlementRows.map((row) => (
            <ScopeItem key={row.key} row={row} selected={row.key === selected.key} onSelect={setSelectedKey} />
          ))}
          {rows.length === 1 && <List.Empty>{t("admin.applications.gates.noneYet")}</List.Empty>}
        </List.Root>
      </CardSection>

      {/* Keyed on the scope AND the saved policies, so the draft resets when
          the selection moves and re-syncs to what the server kept after a
          save or clear (a successful save leaves the draft equal to the
          saved gate, so the remount is invisible). */}
      <GateEditor key={`${selected.key}:${policyVersion}`} row={selected} owner={owner} people={people} />
    </html.div>
  )
}

// ---------------------------------------------------------------------------
// Scope list
// ---------------------------------------------------------------------------

function ScopeGroupLabel({ children }: { children: string }) {
  return (
    <html.div style={styles.groupLabel}>
      <Text variant="overline" color="muted">
        {children}
      </Text>
    </html.div>
  )
}

function ScopeItem({
  row,
  selected,
  onSelect,
  hint,
}: {
  row: ScopeRow
  selected: boolean
  onSelect: (key: string) => void
  hint?: string
}) {
  const { t } = useTranslation()
  const { gate } = row
  const status =
    gate.source === "inherited" ? (
      <Text variant="caption" color="muted">
        {t("admin.applications.gates.status.inherits")}
      </Text>
    ) : gate.source === "none" ? (
      <Badge variant="warning">{t("admin.applications.gates.status.noGate")}</Badge>
    ) : gate.mode === "none" ? (
      <Badge variant="warning">{t("admin.applications.gates.status.openDoor")}</Badge>
    ) : (
      <Badge variant="info">{t("admin.applications.gates.status.gates", { count: gate.rules.length })}</Badge>
    )

  return (
    <List.Item selected={selected} onClick={() => onSelect(row.key)}>
      <List.Content>
        <List.Text>{row.label}</List.Text>
        {hint && <List.Description>{hint}</List.Description>}
      </List.Content>
      <List.Actions>{status}</List.Actions>
    </List.Item>
  )
}

// ---------------------------------------------------------------------------
// Gate editor (right column)
// ---------------------------------------------------------------------------

function GateEditor({ row, owner, people }: { row: ScopeRow; owner: Principal | null; people: Principal[] }) {
  const { t, i18n } = useTranslation()
  const reducedMotion = useReducedMotion()
  const fetcher = useFetcher()
  useFetcherToast(fetcher, {
    render: (data) => {
      const d = data as { success?: boolean; message?: string; error?: string } | null
      if (!d) return null
      if (d.success && d.message) return { variant: "success", message: t(`admin.applications.action.${d.message}`) }
      if (d.error) return { variant: "error", message: t(`admin.applications.action.${d.error}`) }
      return null
    },
  })

  const { scope, gate } = row
  const [mode, setMode] = useState<ApprovalMode>(gate.mode)
  const [rules, setRules] = useState<ApprovalPolicyRule[]>(gate.rules)
  const dirty = mode !== gate.mode || !sameRules(rules, gate.rules)
  const saving = fetcher.state !== "idle"
  const isApp = scope.type === "application"
  const scopeName = isApp ? t("admin.applications.gates.wholeApp") : row.label

  const nameOf = (rule: ApprovalPolicyRule): string =>
    rule.approverType === "app_owner"
      ? `${t("admin.applications.gates.owner")} · ${owner?.displayName ?? t("admin.applications.gates.ownerUnset")}`
      : (people.find((p) => p.id === rule.approverPrincipalId)?.displayName ?? rule.approverPrincipalId ?? "?")

  const slotted = (rule: ApprovalPolicyRule) => rules.some((r) => sameApprover(r, rule))
  const addRule = (rule: ApprovalPolicyRule) => {
    if (slotted(rule)) return
    setRules((prev) => [...prev, rule])
    // Slotting someone onto an open door implies a gate: flip to "any one"
    // so the roster tap is one gesture, not two.
    if (mode === "none") setMode("one_of")
  }
  const removeRule = (rule: ApprovalPolicyRule) => setRules((prev) => prev.filter((r) => !sameApprover(r, rule)))

  const roster: Array<{ rule: ApprovalPolicyRule; name: string; disabled?: boolean }> = [
    { rule: OWNER_RULE, name: nameOf(OWNER_RULE), disabled: owner === null },
    ...people
      .filter((p) => p.id !== owner?.id)
      .map((p) => ({ rule: { approverType: "principal" as const, approverPrincipalId: p.id }, name: p.displayName })),
  ].filter((entry) => !slotted(entry.rule))

  const names = rules.map(nameOf)
  const listFormat = (items: string[], type: "conjunction" | "disjunction") => {
    if (items.length === 0) return t("admin.applications.gates.outcome.nobody")
    if (typeof Intl !== "undefined" && "ListFormat" in Intl) {
      return new Intl.ListFormat(i18n.language, { style: "long", type }).format(items)
    }
    return items.join(", ")
  }
  const outcome =
    mode === "none"
      ? t("admin.applications.gates.outcome.none", { scope: scopeName })
      : mode === "one_of"
        ? t("admin.applications.gates.outcome.one_of", { scope: scopeName, names: listFormat(names, "disjunction") })
        : t("admin.applications.gates.outcome.all_of", { scope: scopeName, names: listFormat(names, "conjunction") })

  const submit = (intent: "saveApprovalGate" | "clearApprovalGate") => {
    const fd = new FormData()
    fd.set("intent", intent)
    fd.set("scopeType", scope.type)
    fd.set("scopeId", scope.id ?? "")
    if (intent === "saveApprovalGate") {
      fd.set("mode", mode)
      fd.set("rules", JSON.stringify(mode === "none" ? [] : rules))
    }
    fetcher.submit(fd, { method: "post" })
  }

  return (
    <Stack gap="md">
      <CardSection
        title={
          isApp
            ? t("admin.applications.gates.editorTitleApp")
            : t("admin.applications.gates.editorTitle", { scope: scopeName })
        }
        action={
          <Badge variant={gate.source === "own" ? "info" : gate.source === "none" ? "warning" : "default"}>
            {t(`admin.applications.gates.source.${gate.source}`)}
          </Badge>
        }
      >
        <Stack gap="md">
          {/* The track */}
          <html.div style={styles.track} role="group" aria-label={t("admin.applications.gates.tryIt")}>
            <TrackNode label={t("admin.applications.gates.track.request")} />
            <Connector />
            {mode !== "none" &&
              rules.map((rule) => (
                <Fragment key={rule.approverType === "app_owner" ? "owner" : rule.approverPrincipalId}>
                  <html.div style={styles.node}>
                    <SlotIn animate={!reducedMotion} style={styles.gate}>
                      <Tag
                        variant="info"
                        removable
                        onRemove={() => removeRule(rule)}
                        aria-label={t("admin.applications.gates.removeGate", { name: nameOf(rule) })}
                      >
                        {nameOf(rule)}
                      </Tag>
                    </SlotIn>
                    <Text variant="caption" color="muted">
                      {mode === "all_of"
                        ? t("admin.applications.gates.track.mustOpen")
                        : t("admin.applications.gates.track.canOpen")}
                    </Text>
                  </html.div>
                  <Connector />
                </Fragment>
              ))}
            {mode !== "none" && rules.length === 0 && (
              <>
                <html.div style={styles.node}>
                  <html.div style={[styles.gate, styles.gateEmpty]}>
                    <Text variant="caption" color="muted">
                      {t("admin.applications.gates.track.empty")}
                    </Text>
                  </html.div>
                </html.div>
                <Connector />
              </>
            )}
            <TrackNode
              label={t("admin.applications.gates.track.granted")}
              hint={t("admin.applications.gates.track.grantedHint")}
              tone={mode === "none" ? "warning" : "success"}
            />
          </html.div>

          {mode === "none" && (
            <Callout variant="warning">
              {gate.source === "none" && !dirty
                ? t("admin.applications.gates.noGateWarning", { scope: scopeName })
                : t("admin.applications.gates.openDoorWarning", { scope: scopeName })}
            </Callout>
          )}

          <Inline gap="sm" align="center">
            <Text variant="bodySm" color="muted">
              {t("admin.applications.gates.modeLabel")}
            </Text>
            <ToggleGroup
              value={[mode]}
              onValueChange={(v) => {
                const next = v[0] as ApprovalMode | undefined
                if (next) setMode(next)
              }}
              multiple={false}
              size="small"
            >
              <Toggle value="none">{t("admin.applications.gates.mode.none")}</Toggle>
              <Toggle value="one_of">{t("admin.applications.gates.mode.one_of")}</Toggle>
              <Toggle value="all_of">{t("admin.applications.gates.mode.all_of")}</Toggle>
            </ToggleGroup>
          </Inline>
        </Stack>
      </CardSection>

      <CardSection
        title={t("admin.applications.gates.rosterTitle")}
        action={
          <Text variant="caption" color="muted">
            {t("admin.applications.gates.rosterHint")}
          </Text>
        }
      >
        {roster.length === 0 ? (
          <Text variant="bodySm" color="muted">
            {t("admin.applications.gates.rosterEmpty")}
          </Text>
        ) : (
          <Cluster gap="sm">
            {roster.map((entry) => (
              <Button
                key={entry.rule.approverType === "app_owner" ? "owner" : entry.rule.approverPrincipalId}
                variant="secondary"
                size="small"
                disabled={entry.disabled || saving}
                aria-label={t("admin.applications.gates.addToGates", { name: entry.name })}
                onClick={() => addRule(entry.rule)}
              >
                {entry.name}
              </Button>
            ))}
          </Cluster>
        )}
      </CardSection>

      <html.div style={styles.tryIt}>
        <Inline gap="sm" align="center">
          <Icon name="route" size="md" />
          <Text variant="label">{t("admin.applications.gates.tryIt")}</Text>
        </Inline>
        <Text variant="bodySm" color="muted" as="p">
          {outcome}
        </Text>
      </html.div>

      <Inline gap="sm" align="center" justify="between">
        <Inline gap="sm" align="center">
          <Button variant="primary" disabled={!dirty || saving} onClick={() => submit("saveApprovalGate")}>
            {saving ? t("admin.applications.gates.saving") : t("admin.applications.gates.save")}
          </Button>
          {dirty && (
            <Button
              variant="link"
              disabled={saving}
              onClick={() => {
                setMode(gate.mode)
                setRules(gate.rules)
              }}
            >
              {t("admin.applications.gates.reset")}
            </Button>
          )}
          {dirty && <Badge variant="warning">{t("admin.applications.gates.unsaved")}</Badge>}
        </Inline>
        {!isApp && gate.source === "own" && (
          <Button variant="secondary" size="small" disabled={saving} onClick={() => submit("clearApprovalGate")}>
            {t("admin.applications.gates.clear")}
          </Button>
        )}
      </Inline>
    </Stack>
  )
}

function TrackNode({
  label,
  hint,
  tone = "default",
}: {
  label: string
  hint?: string
  tone?: "default" | "success" | "warning"
}) {
  return (
    <html.div style={styles.node}>
      <html.div style={[styles.box, tone === "success" && styles.boxSuccess, tone === "warning" && styles.boxWarning]}>
        <Text variant="bodySm" weight="medium">
          {label}
        </Text>
      </html.div>
      {hint && (
        <Text variant="caption" color="muted">
          {hint}
        </Text>
      )}
    </html.div>
  )
}

function Connector() {
  return <html.div style={styles.connector} aria-hidden={true} />
}

/**
 * Scale-and-fade a freshly slotted gate into place. Mounts hidden, then flips
 * to visible on the next frame so the StyleX transition runs; the flip is
 * deferred through requestAnimationFrame rather than set synchronously in the
 * effect. react-strict-dom has no keyframes API in this version, so a class
 * toggle with a transition is the portable way to animate a mount.
 */
function SlotIn({ animate, style, children }: { animate: boolean; style: StyleProp; children: React.ReactNode }) {
  const [shown, setShown] = useState(!animate)
  useEffect(() => {
    if (!animate) return
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [animate])
  return <html.div style={[style, styles.slot, !shown && styles.slotHidden]}>{children}</html.div>
}

type StyleProp = React.ComponentProps<typeof html.div>["style"]

const styles = css.create({
  // Scopes are a narrow list; the track needs the width. Two columns weighted
  // 1:2 from tablet up, a single stacked column on phones.
  board: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      "@media (min-width: 768px)": "minmax(240px, 1fr) minmax(0, 2fr)",
    },
    gap: spacing.md,
    alignItems: "start",
  },
  groupLabel: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    paddingLeft: spacing.ms,
  },
  track: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    flexWrap: "wrap",
    rowGap: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  node: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: spacing.xs,
    minWidth: 96,
  },
  box: {
    minWidth: 96,
    height: 48,
    paddingLeft: spacing.ms,
    paddingRight: spacing.ms,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.bgCardHover,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  },
  boxSuccess: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successBg,
  },
  boxWarning: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningBg,
  },
  gate: {
    height: 48,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  },
  slot: {
    transitionProperty: "opacity, transform",
    transitionDuration: duration.base,
    transitionTimingFunction: easing.easeOut,
  },
  slotHidden: {
    opacity: 0,
    transform: "scale(0.85)",
  },
  gateEmpty: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingLeft: spacing.ms,
    paddingRight: spacing.ms,
  },
  connector: {
    width: 24,
    height: 2,
    marginTop: 23,
    backgroundColor: colors.border,
    flexShrink: 0,
  },
  tryIt: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    padding: spacing.ms,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.bg,
    fontFamily: typography.fontFamily,
  },
})
