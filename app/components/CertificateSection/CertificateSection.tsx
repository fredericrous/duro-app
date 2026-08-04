import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import type { SettingsResult } from "~/lib/mutations/settings"
import { useFetcherToast } from "~/lib/useFetcherToast"
import { useDisplayFormat } from "~/hooks/useDisplayFormat"
import { Alert, Badge, Button, Inline, Input, ScrollArea, Stack, Table, Text, type ToastOptions } from "@duro-app/ui"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function expiryStatus(expiresAt: string): "ok" | "soon" | "imminent" | "expired" {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / ONE_DAY_MS)
  if (days <= 0) return "expired"
  if (days <= 7) return "imminent"
  if (days <= 30) return "soon"
  return "ok"
}

/**
 * 24h renewal cooldown, derived from the wall clock at call time (module
 * level, like expiryStatus, so components stay compiler-pure and a lapsed
 * cooldown unlocks on the next render without a remount).
 */
function cooldownState(
  lastCertRenewalAt: string | null | undefined,
): { inCooldown: true; cooldownEndsAt: number } | { inCooldown: false } {
  const twentyFourHours = 24 * 60 * 60 * 1000
  const cooldownEndsAt = lastCertRenewalAt ? new Date(lastCertRenewalAt).getTime() + twentyFourHours : null
  return cooldownEndsAt !== null && Date.now() < cooldownEndsAt
    ? { inCooldown: true, cooldownEndsAt }
    : { inCooldown: false }
}

function daysUntil(expiresAt: string): number {
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / ONE_DAY_MS)
}

/**
 * Toast copy for a settled cert mutation. The list can be long enough that a
 * given row — or the section's own alerts — sits well off-screen from whatever
 * the user just clicked, so outcomes are announced where they're looking.
 * `rateLimited` is the exception: it renders inline as the cooldown text right
 * under the disabled button.
 */
function certToast(raw: unknown, t: (key: string) => string): ToastOptions | null {
  const d = raw as SettingsResult | null
  if (!d) return null
  if ("certSent" in d) return { variant: "success", message: t("settings.cert.success") }
  if ("certRevoked" in d) return { variant: "success", message: t("settings.cert.list.revoked") }
  if ("certRenamed" in d) return { variant: "success", message: t("settings.cert.list.renamed") }
  if ("certError" in d) return { variant: "error", message: d.certError }
  if ("error" in d) return { variant: "error", message: d.error }
  return null
}

// Cert actions live on the certificate settings sub-route now.
const API_URL = "/settings/certificate"

function CertRow({ cert }: { cert: UserCertificate }) {
  const { t } = useTranslation()
  const { formatDate } = useDisplayFormat()
  const [confirming, setConfirming] = useState(false)
  const [renaming, setRenaming] = useState(false)
  // Optimistic device label: the submitted value shows while the rename is in
  // flight or once the server confirmed it — otherwise `cert.label` stays the
  // source of truth, so a loader revalidation can never render a stale label.
  const [pendingLabel, setPendingLabel] = useState<{ value: string | null } | null>(null)
  const fetcher = useFetcher<SettingsResult>()
  useFetcherToast(fetcher, { render: (d) => certToast(d, t) })
  const isSubmitting = fetcher.state !== "idle"
  const renamed = fetcher.data != null && "certRenamed" in fetcher.data
  const revoked = fetcher.data != null && "certRevoked" in fetcher.data
  const label = pendingLabel && (isSubmitting || renamed) ? pendingLabel.value : cert.label

  // The revalidation a revoke triggers drops this row from the loader data
  // anyway; hiding it here just covers the gap until that lands.
  if (revoked) return null

  const serialShort = cert.serialNumber.slice(-8)

  return (
    <Table.Row>
      <Table.Cell>
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              const next = ((fd.get("label") as string) ?? "").trim() || null
              void fetcher.submit(fd, { method: "post", action: API_URL })
              setPendingLabel({ value: next })
              setRenaming(false)
            }}
          >
            <input type="hidden" name="intent" value="renameCert" />
            <input type="hidden" name="serialNumber" value={cert.serialNumber} />
            <Inline gap="sm">
              <Input
                name="label"
                defaultValue={label ?? ""}
                placeholder={t("settings.cert.devicePlaceholder")}
                maxLength={64}
              />
              <Button type="submit" variant="primary" size="small" disabled={isSubmitting}>
                {t("common.save")}
              </Button>
              <Button type="button" variant="secondary" size="small" onClick={() => setRenaming(false)}>
                {t("common.cancel")}
              </Button>
            </Inline>
          </form>
        ) : (
          <Inline gap="sm" align="center">
            {label ? (
              <Text as="span">{label}</Text>
            ) : (
              <Text as="span" color="muted">
                {t("settings.cert.list.unnamed")}
              </Text>
            )}
            <Button type="button" variant="link" size="small" onClick={() => setRenaming(true)}>
              {t("settings.cert.list.rename")}
            </Button>
          </Inline>
        )}
      </Table.Cell>
      <Table.Cell>
        <code title={cert.serialNumber} style={{ fontFamily: "monospace" }}>
          {serialShort}
        </code>
      </Table.Cell>
      <Table.Cell>{formatDate(cert.issuedAt)}</Table.Cell>
      <Table.Cell>
        <Inline gap="sm">
          <Text as="span">{formatDate(cert.expiresAt)}</Text>
          {(() => {
            const status = expiryStatus(cert.expiresAt)
            if (status === "expired") {
              return (
                <Badge variant="error" size="sm">
                  {t("settings.cert.list.expired")}
                </Badge>
              )
            }
            if (status === "imminent") {
              return (
                <Badge variant="error" size="sm">
                  {t("settings.cert.list.expiresInDays", { count: Math.max(daysUntil(cert.expiresAt), 0) })}
                </Badge>
              )
            }
            if (status === "soon") {
              return (
                <Badge variant="warning" size="sm">
                  {t("settings.cert.list.expiresInDays", { count: daysUntil(cert.expiresAt) })}
                </Badge>
              )
            }
            return null
          })()}
        </Inline>
      </Table.Cell>
      <Table.Cell>
        {confirming ? (
          <Inline gap="sm">
            <fetcher.Form method="post" action={API_URL}>
              <input type="hidden" name="intent" value="revokeCert" />
              <input type="hidden" name="serialNumber" value={cert.serialNumber} />
              <Button type="submit" variant="danger" size="small" disabled={isSubmitting}>
                {isSubmitting ? t("settings.cert.list.revoking") : t("settings.cert.list.revokeYes")}
              </Button>
            </fetcher.Form>
            <Button variant="secondary" size="small" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
          </Inline>
        ) : cert.revokeState === "pending" ? (
          <Text variant="bodySm" color="muted">
            {t("settings.cert.list.revoking")}
          </Text>
        ) : cert.revokeState === "failed" ? (
          <Button variant="danger" size="small" onClick={() => setConfirming(true)}>
            {t("settings.cert.list.revokeFailed")}
          </Button>
        ) : (
          <Button variant="danger" size="small" onClick={() => setConfirming(true)}>
            {t("settings.cert.list.revoke")}
          </Button>
        )}
      </Table.Cell>
    </Table.Row>
  )
}

export function CertificateSection({
  email,
  lastCertRenewalAt,
  certificates,
}: {
  email: string | null
  lastCertRenewalAt: string | null
  certificates: UserCertificate[]
}) {
  const { t } = useTranslation()
  const { formatDateTime } = useDisplayFormat()
  const fetcher = useFetcher<SettingsResult>()
  useFetcherToast(fetcher, { render: (d) => certToast(d, t) })
  const [confirming, setConfirming] = useState(false)

  const result = fetcher.data
  const isSubmitting = fetcher.state !== "idle"
  const justSent = result != null && "certSent" in result

  // Collapse the form once the certificate is on its way — an open form sitting
  // under a list that just grew a row reads as "nothing happened, try again".
  // Adjusted during render (React's state-derived-from-data pattern) rather
  // than in an effect, which would be a cascading-render hazard. Keying off the
  // result's identity means reopening the form later doesn't re-close it.
  const [handledResult, setHandledResult] = useState<SettingsResult | undefined>(undefined)
  if (result !== handledResult) {
    setHandledResult(result)
    if (justSent) setConfirming(false)
  }

  // Rate limit check — derived per render (module-level helper, same pattern
  // as expiryStatus above) so a lapsed cooldown unlocks without a remount.
  const isRateLimited = result != null && "rateLimited" in result
  const cooldown = cooldownState(lastCertRenewalAt)
  const cooldownRemaining = isRateLimited || cooldown.inCooldown
  const nextAvailableText = isRateLimited
    ? formatDateTime(result.nextAvailable)
    : cooldown.inCooldown
      ? formatDateTime(cooldown.cooldownEndsAt)
      : ""

  return (
    <Stack gap="md">
      <Text as="p" color="muted">
        {t("settings.cert.description")}
      </Text>

      {certificates.length > 0 && (
        <ScrollArea.Root>
          <ScrollArea.Viewport>
            <ScrollArea.Content>
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.HeaderCell>{t("settings.cert.list.device")}</Table.HeaderCell>
                    <Table.HeaderCell>{t("settings.cert.list.serial")}</Table.HeaderCell>
                    <Table.HeaderCell>{t("settings.cert.list.issued")}</Table.HeaderCell>
                    <Table.HeaderCell>{t("settings.cert.list.expires")}</Table.HeaderCell>
                    <Table.HeaderCell>{t("common.actions")}</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {certificates.map((cert) => (
                    <CertRow key={cert.id} cert={cert} />
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

      {certificates.length === 0 && (
        <Text as="p" color="muted" variant="bodySm">
          {t("settings.cert.list.empty")}
        </Text>
      )}

      {/* Feedback lives with the controls that produced it. The list above can
          run long, so an alert at the top of the section is off-screen for
          anyone working at the bottom of it — which is where the button is. */}
      {result && "certError" in result && <Alert variant="error">{result.certError}</Alert>}

      {justSent && <Alert variant="success">{t("settings.cert.success")}</Alert>}

      {cooldownRemaining ? (
        <Stack gap="sm">
          <Button disabled>{t("settings.cert.newCert")}</Button>
          <Text as="p" variant="bodySm" color="muted">
            {t("settings.cert.nextAvailable", { time: nextAvailableText })}
          </Text>
        </Stack>
      ) : confirming ? (
        <Stack gap="sm">
          <Text as="p">{t("settings.cert.confirm", { email })}</Text>
          <fetcher.Form method="post" action={API_URL}>
            <Stack gap="sm">
              <input type="hidden" name="intent" value="issueCert" />
              <Input name="label" placeholder={t("settings.cert.devicePlaceholder")} maxLength={64} />
              <Inline gap="sm">
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? t("settings.cert.issuing") : t("settings.cert.confirmButton")}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                  {t("common.cancel")}
                </Button>
              </Inline>
            </Stack>
          </fetcher.Form>
        </Stack>
      ) : (
        <Button variant="primary" onClick={() => setConfirming(true)}>
          {t("settings.cert.newCert")}
        </Button>
      )}
    </Stack>
  )
}
