import { useState } from "react"
import { Effect } from "effect"
import type { Route } from "./+types/catalog"
import { Link, useRouteLoaderData } from "react-router"
import { useTranslation } from "react-i18next"
import { Badge, Button, EmptyState, PageShell, ScrollArea, Stack, Table, Text } from "@duro-app/ui"
import { Header } from "~/components/Header/Header"
import { CardSection } from "~/components/CardSection/CardSection"
import { HelpPopover } from "~/components/HelpPopover/HelpPopover"
import { RequestAccessDialog } from "~/components/RequestAccessDialog/RequestAccessDialog"
import { runEffect } from "~/lib/runtime.server"
import { authMode } from "~/lib/governance-mode.server"
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
  return { appsCatalog }
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

export default function AppsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const { appsCatalog } = loaderData
  const dashboardData = useRouteLoaderData("routes/dashboard") as { user?: string; isAdmin?: boolean } | undefined
  const user = dashboardData?.user ?? ""
  const isAdmin = dashboardData?.isAdmin ?? false

  const [dialogOpen, setDialogOpen] = useState(false)
  const [preselectedAppId, setPreselectedAppId] = useState<string | undefined>(undefined)

  const openRequestDialog = (appId: string) => {
    setPreselectedAppId(appId)
    setDialogOpen(true)
  }

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
            <ScrollArea.Root>
              <ScrollArea.Viewport>
                <ScrollArea.Content>
                  <Table.Root>
                    <Table.Header>
                      <Table.Row>
                        <Table.HeaderCell>{t("apps.cols.app")}</Table.HeaderCell>
                        <Table.HeaderCell>{t("apps.cols.status")}</Table.HeaderCell>
                        <Table.HeaderCell>{t("apps.cols.action")}</Table.HeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {appsCatalog.map((entry) => (
                        <Table.Row key={entry.app.id}>
                          <Table.Cell>
                            <Stack gap="xs">
                              <Text>{entry.app.displayName}</Text>
                              {entry.app.description && (
                                <Text variant="bodySm" color="muted">
                                  {entry.app.description}
                                </Text>
                              )}
                            </Stack>
                          </Table.Cell>
                          <Table.Cell>
                            <Badge variant={stateBadgeVariant[entry.state]}>{stateLabel(entry.state)}</Badge>
                          </Table.Cell>
                          <Table.Cell>
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
                            {entry.state === "granted_full" && (
                              <Text color="muted" variant="bodySm">
                                {t("apps.allRolesGrantedHint")}
                              </Text>
                            )}
                            {entry.state === "pending" && (
                              <Link to="/requests">
                                <Button variant="secondary">{t("apps.viewRequest")}</Button>
                              </Link>
                            )}
                            {entry.state === "invite_only" && (
                              <Text color="muted" variant="bodySm">
                                {t("apps.inviteOnlyHint")}
                              </Text>
                            )}
                            {entry.state === "open" && entry.app.url && (
                              <a href={entry.app.url} target="_blank" rel="noopener noreferrer">
                                <Button variant="secondary">{t("apps.openLaunch")}</Button>
                              </a>
                            )}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>
                </ScrollArea.Content>
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar orientation="horizontal">
                <ScrollArea.Thumb orientation="horizontal" />
              </ScrollArea.Scrollbar>
            </ScrollArea.Root>
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
