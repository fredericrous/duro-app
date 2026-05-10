import { useEffect } from "react"
import { useFetcher, useRevalidator } from "react-router"
import { useTranslation } from "react-i18next"
import { Alert, Dialog, Spinner, Stack, Text } from "@duro-app/ui"
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

  // Refresh route loaders on a real state change so /catalog and /requests
  // pick up the new pending/granted row, then close. Duplicates are no-ops
  // server-side — skip revalidation; just close after the user reads the alert.
  const data = (submitFetcher.data ?? null) as
    | { outcome: "submitted" | "auto_approved" | "duplicate" }
    | { outcome: "error" }
    | null
  const isFreshSuccess = data?.outcome === "submitted" || data?.outcome === "auto_approved"
  const isDuplicate = data?.outcome === "duplicate"
  useEffect(() => {
    if ((isFreshSuccess || isDuplicate) && open) {
      if (isFreshSuccess) revalidator.revalidate()
      const id = setTimeout(() => onOpenChange(false), 1200)
      return () => clearTimeout(id)
    }
  }, [isFreshSuccess, isDuplicate, open, onOpenChange, revalidator])

  const sourceApps: ReadonlyArray<AppCatalogEntry> = apps ?? catalogFetcher.data?.apps ?? []
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
          {isCatalogLoading ? (
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
