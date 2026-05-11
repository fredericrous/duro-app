import { useMemo, useState } from "react"
import { Effect } from "effect"
import type { Route } from "./+types/catalog"
import { Link, useRouteLoaderData } from "react-router"
import { useTranslation } from "react-i18next"
import { Badge, Button, EmptyState, Inline, PageShell, Stack, Table, Text } from "@duro-app/ui"
import { css, html } from "react-strict-dom"
import { Header } from "~/components/Header/Header"
import { Icon } from "~/components/Icon"
import { CardSection } from "~/components/CardSection/CardSection"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"
import { RequestAccessDialog } from "~/components/RequestAccessDialog/RequestAccessDialog"
import { runEffect } from "~/lib/runtime.server"
import { authMode } from "~/lib/governance-mode.server"
import { loadApps } from "~/lib/apps.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { loadAppsCatalogForPrincipal, type AppCatalogEntry, type AppCatalogState } from "~/lib/apps-catalog.server"

export function meta() {
  return [{ title: "Catalog - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const { getAuth } = await import("~/lib/auth.server")
  const auth = await getAuth(request)

  let appsCatalog: AppCatalogEntry[] = []
  if (authMode !== "legacy" && auth.sub) {
    try {
      appsCatalog = await runEffect(
        Effect.gen(function* () {
          const repo = yield* PrincipalRepo
          const principal = yield* repo.findByExternalId(auth.sub!)
          if (!principal) return [] as AppCatalogEntry[]
          return yield* loadAppsCatalogForPrincipal(principal.id)
        }),
      )
    } catch (err) {
      await runEffect(Effect.logWarning("catalog page load failed", { error: String(err) }))
    }
  }

  // Map slug → icon SVG using the static apps.json registry. The governance
  // applications table doesn't yet store icons; matching by slug lets us
  // surface the same artwork the homepage AppCards use without a schema
  // change. Empty string when no match — the row falls back to no icon.
  const iconBySlug: Record<string, string> = {}
  try {
    for (const a of loadApps()) {
      if (a.id && a.icon) iconBySlug[a.id] = a.icon
    }
  } catch {
    // loadApps reads /data/apps.json — falls through to default if missing.
  }

  return { appsCatalog, iconBySlug }
}

const stateBadgeVariant: Record<AppCatalogState, "default" | "success" | "warning" | "info"> = {
  open: "info",
  // Distinguish "you have everything" from "you have something but could ask for more"
  // so a glance at the badge column carries the same information as the action column.
  granted_can_upgrade: "info",
  granted_full: "success",
  pending: "warning",
  requestable: "default",
  invite_only: "default",
}

// Order rows so the user's eye lands on actionable rows first and the inert
// "informational only" states (invite_only / granted_full) settle at the
// bottom. This matters more than alphabetical order on a discovery surface
// where the user is asking "what can I do right now?".
const statePriority: Record<AppCatalogState, number> = {
  granted_can_upgrade: 0, // partial access, can upgrade — top
  requestable: 1, // self-request available
  open: 2, // open-launchable app
  pending: 3, // request already submitted, waiting
  invite_only: 4, // admin grants, no CTA
  granted_full: 5, // already fully granted, also on /home
}

const styles = css.create({
  iconWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    flexShrink: 0,
    color: "#6aaffc",
  },
})

export default function AppsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { appsCatalog, iconBySlug } = loaderData
  const dashboardData = useRouteLoaderData("routes/dashboard") as { user?: string; isAdmin?: boolean } | undefined
  const user = dashboardData?.user ?? ""
  const isAdmin = dashboardData?.isAdmin ?? false

  const [dialogOpen, setDialogOpen] = useState(false)
  const [preselectedAppId, setPreselectedAppId] = useState<string | undefined>(undefined)

  const openRequestDialog = (appId: string) => {
    setPreselectedAppId(appId)
    setDialogOpen(true)
  }

  // Sort by actionability so the rows the user can do something about float
  // to the top. Stable sort preserves the loader's secondary order
  // (alphabetical / category) within each priority group.
  const sortedCatalog = useMemo(
    () => [...appsCatalog].sort((a, b) => statePriority[a.state] - statePriority[b.state]),
    [appsCatalog],
  )

  const stateLabel = (state: AppCatalogState) => {
    switch (state) {
      case "open":
        return t("apps.status.open")
      case "granted_can_upgrade":
        return t("apps.status.partiallyGranted")
      case "granted_full":
        return t("apps.status.granted")
      case "pending":
        return t("apps.status.pending")
      case "requestable":
        return t("apps.status.requestable")
      case "invite_only":
        return t("apps.status.inviteOnly")
    }
  }

  return (
    <PageShell maxWidth="lg" header={<Header user={user} isAdmin={isAdmin} />}>
      <Stack gap="md">
        <CardSection
          title={
            <>
              {t("apps.title")}
              <HelpPopover termKey="glossary.appsCatalog" />
            </>
          }
        >
          {appsCatalog.length === 0 ? (
            <EmptyState message={t("apps.empty")} />
          ) : (
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  {/* At desktop, keep evenly-distributed minmax(0,1fr) columns
                      so the action content doesn't sit right next to the badge.
                      In compact mode (≤720px container) switch to a content-aware
                      layout: status shrinks to its badge size and the action
                      column absorbs the slack so the hint text fits on one line
                      (or wraps to 2 lines at the narrowest end of the band, never
                      ellipsis-truncated). */}
                  <Table.HeaderCell>{t("apps.cols.app")}</Table.HeaderCell>
                  <Table.HeaderCell compactWidth="max-content">{t("apps.cols.status")}</Table.HeaderCell>
                  <Table.HeaderCell compactWidth="minmax(0, 2fr)">{t("apps.cols.action")}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {sortedCatalog.map((entry) => {
                  const icon = iconBySlug[entry.app.slug]
                  return (
                    <Table.Row key={entry.app.id}>
                      <Table.Cell>
                        <Inline gap="md" align="center">
                          {icon && (
                            <html.div style={styles.iconWrap}>
                              <Icon svg={icon} size={32} />
                            </html.div>
                          )}
                          <Stack gap="xs">
                            <Text>{entry.app.displayName}</Text>
                            {entry.app.description && (
                              <Text variant="bodySm" color="muted">
                                {entry.app.description}
                              </Text>
                            )}
                          </Stack>
                        </Inline>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge variant={stateBadgeVariant[entry.state]}>{stateLabel(entry.state)}</Badge>
                      </Table.Cell>
                      {/* Action cell: right-aligned by convention for BI/admin
                          tables. States with no user-actionable affordance
                          (granted_full, invite_only) intentionally render an
                          empty cell — the status badge already carries the
                          information, restating it as muted prose in the action
                          column would just create visual noise without giving
                          the user anything they could click. */}
                      <Table.Cell>
                        <Inline justify="end">
                          {entry.state === "requestable" && (
                            <Button variant="primary" onClick={() => openRequestDialog(entry.app.id)}>
                              {t("apps.status.requestable")}
                            </Button>
                          )}
                          {entry.state === "granted_can_upgrade" && (
                            <Button variant="secondary" onClick={() => openRequestDialog(entry.app.id)}>
                              {t("apps.status.canUpgrade")}
                            </Button>
                          )}
                          {entry.state === "pending" && (
                            <Link to="/requests">
                              <Button variant="secondary">{t("apps.viewRequest")}</Button>
                            </Link>
                          )}
                          {entry.state === "open" && entry.app.url && (
                            <a href={entry.app.url} target="_blank" rel="noopener noreferrer">
                              <Button variant="secondary">{t("apps.openLaunch")}</Button>
                            </a>
                          )}
                        </Inline>
                      </Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table.Root>
          )}
        </CardSection>
      </Stack>
      <RequestAccessDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        apps={appsCatalog}
        preselectedAppId={preselectedAppId}
      />
    </PageShell>
  )
}
