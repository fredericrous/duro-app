import { useEffect } from "react"
import { useFetcher, useRevalidator } from "react-router"
import { useTranslation } from "react-i18next"
import { Alert, Button, Dialog, Inline, LinkButton, Spinner, Stack, Text } from "@duro-app/ui"
import { RequestAccessForm } from "~/components/RequestAccessForm/RequestAccessForm"
import type { AppCatalogEntry } from "~/lib/apps-catalog.server"

interface RequestAccessDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Optional preloaded catalog. When omitted, the dialog fetches from
   * /api/catalog on open — used by the Header so opening the dialog from
   * any page doesn't require the layout to preload the catalog.
   */
  apps?: ReadonlyArray<AppCatalogEntry>
  /** Where the form posts. Defaults to "/?index" so the home action handles it. */
  action?: string
  preselectedAppId?: string
}

export function RequestAccessDialog({
  open,
  onOpenChange,
  apps,
  action = "/?index",
  preselectedAppId,
}: RequestAccessDialogProps) {
  const { t } = useTranslation()
  const submitFetcher = useFetcher()
  const catalogFetcher = useFetcher<{ apps: AppCatalogEntry[] }>()
  const revalidator = useRevalidator()

  // When apps aren't passed in, fetch on open. Idempotent guard: only kick
  // off the load once per open cycle and only if we don't already have data.
  const shouldFetch = apps === undefined
  useEffect(() => {
    if (open && shouldFetch && catalogFetcher.state === "idle" && catalogFetcher.data === undefined) {
      catalogFetcher.load("/api/catalog")
    }
  }, [open, shouldFetch, catalogFetcher])

  const data = (submitFetcher.data ?? null) as
    | { outcome: "submitted" | "auto_approved" | "duplicate"; applicationId: string }
    | { outcome: "error" }
    | null
  // Terminal outcomes (a request resolved) get a completion moment; errors stay
  // in the form. Narrow here so `terminal.outcome` is the resolved-only union.
  const terminal = data && data.outcome !== "error" ? data : null
  const isFreshSuccess = terminal?.outcome === "submitted" || terminal?.outcome === "auto_approved"
  // Refresh route loaders on a real state change so /catalog and /requests pick
  // up the new pending/granted row. We deliberately DON'T auto-close on success
  // anymore — the dialog shows a completion moment (see OutcomePanel) that the
  // user dismisses (or acts on via "Open app").
  useEffect(() => {
    if (isFreshSuccess && open) revalidator.revalidate()
  }, [isFreshSuccess, open, revalidator])

  const sourceApps: ReadonlyArray<AppCatalogEntry> = apps ?? catalogFetcher.data?.apps ?? []
  const requestedApp = terminal ? sourceApps.find((e) => e.app.id === terminal.applicationId)?.app : undefined
  // Only apps the user can act on (request fresh or upgrade). Pending apps
  // would dedup to the existing request and confuse the user.
  const dialogApps = sourceApps.filter((e) => e.state === "requestable" || e.state === "granted_can_upgrade")

  const isCatalogLoading = shouldFetch && (catalogFetcher.state === "loading" || catalogFetcher.data === undefined)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal size="md">
        <Dialog.Header>
          <Dialog.Title>{t("header.requestAccess")}</Dialog.Title>
          <Dialog.Close aria-label={t("admin.detailPanel.close")} />
        </Dialog.Header>
        <Dialog.Body>
          {terminal ? (
            <OutcomePanel
              outcome={terminal.outcome}
              appName={requestedApp?.displayName}
              appUrl={requestedApp?.url || undefined}
              onClose={() => onOpenChange(false)}
            />
          ) : isCatalogLoading ? (
            <Stack gap="sm" align="center">
              <Spinner />
              <Text color="muted">{t("header.requestDialog.loading")}</Text>
            </Stack>
          ) : dialogApps.length === 0 ? (
            // Empty-state copy doubles as positive feedback ("you already have
            // everything") and as a config explainer ("nothing self-service").
            <Alert variant="info">{t("header.requestDialog.empty")}</Alert>
          ) : (
            <RequestAccessForm
              apps={dialogApps}
              fetcher={submitFetcher}
              action={action}
              preselectedAppId={preselectedAppId}
              onCancel={() => onOpenChange(false)}
            />
          )}
        </Dialog.Body>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// The completion moment shown after a request resolves. Auto-approval is the
// star case: it confirms the grant and hands the user a direct "Open app" CTA
// so the loop closes on their actual goal rather than silently dismissing.
export function OutcomePanel({
  outcome,
  appName,
  appUrl,
  onClose,
}: {
  outcome: "submitted" | "auto_approved" | "duplicate"
  appName?: string
  appUrl?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const app = appName ?? t("header.requestDialog.outcome.thisApp")
  const isGranted = outcome === "auto_approved"

  return (
    <Stack gap="md">
      <Alert variant={isGranted ? "success" : "info"}>{t(`header.requestDialog.outcome.${outcome}`, { app })}</Alert>
      <Inline gap="sm" justify="end">
        {isGranted && appUrl ? (
          <LinkButton href={appUrl} target="_blank" variant="primary">
            {t("header.requestDialog.outcome.open", { app })}
          </LinkButton>
        ) : (
          <LinkButton href="/requests" variant="secondary">
            {t("header.requestDialog.outcome.viewRequests")}
          </LinkButton>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t("common.done")}
        </Button>
      </Inline>
    </Stack>
  )
}
