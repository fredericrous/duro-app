import { Fragment, useState } from "react"
import { css, html } from "react-strict-dom"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import { NEW_DEVICE_LIMIT, type DeviceBudget } from "~/lib/device-budget"
import type { SettingsResult } from "~/lib/mutations/settings"
import { useFetcherToast } from "~/lib/useFetcherToast"
import { useDisplayFormat } from "~/hooks/useDisplayFormat"
import { daysUntil, expiryStatus } from "~/lib/cert-status"
import { buildDeviceRows, renewalCooldownUntil, sortDeviceRows, type DeviceSort } from "~/lib/devices"
import { CardSection } from "~/components/CardSection/CardSection"
import { QrCode } from "~/components/QrCode/QrCode"
import { useCopyFeedback } from "~/hooks/useCopyFeedback"
import {
  Alert,
  Dialog,
  Badge,
  Button,
  Inline,
  Input,
  ScrollArea,
  Spinner,
  Stack,
  Table,
  Text,
  Toggle,
  ToggleGroup,
  Tooltip,
  type ToastOptions,
} from "@duro-app/ui"

/**
 * Toast copy for a settled cert mutation. The list can be long enough that a
 * given row — or the section's own alerts — sits well off-screen from whatever
 * the user just clicked, so outcomes are announced where they're looking.
 */
function certToast(raw: unknown, t: (key: string) => string): ToastOptions | null {
  const d = raw as SettingsResult | null
  if (!d) return null
  if ("certSent" in d) return { variant: "success", message: t("devices.success") }
  if ("certRevoked" in d) return { variant: "success", message: t("devices.list.revoked") }
  if ("certRenamed" in d) return { variant: "success", message: t("devices.list.renamed") }
  // A row's renew button has no inline cooldown text to fall back on the way
  // the section's "add a device" button does, so this has to be announced.
  if ("rateLimited" in d) return { variant: "error", message: t("devices.renewTooSoon") }
  if ("certError" in d) return { variant: "error", message: d.certError }
  if ("error" in d) return { variant: "error", message: d.error }
  return null
}

const API_URL = "/devices"

/**
 * The QR keeps its own size constant so the pending placeholder can reserve
 * exactly the space the code will occupy — the dialog must not resize under
 * the user's eyes when the link arrives.
 */
const QR_SIZE = 224

const styles = css.create({
  qrSlot: {
    width: QR_SIZE,
    height: QR_SIZE,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
})

/**
 * What the claim dialog is showing. One click opens the dialog immediately —
 * every outcome then lands INSIDE it, because a disabled button and a muted
 * line of body text elsewhere on the page is not feedback: the click gets
 * swallowed and the user is told nothing.
 */
type ClaimState =
  | { kind: "pending" }
  | { kind: "ready"; revealToken: string; expiresAt: string; claimUrl: string }
  | { kind: "cooldown"; nextAvailable: string }
  | { kind: "error"; message: string }

/**
 * The QR handoff for a freshly issued device certificate. The link is the
 * same single-use /cert/:token the email flow sends — here it's shown
 * directly so the NEW device can scan its way in without a mailbox on it.
 * The token is a bearer secret with a TTL: shown once to the authenticated
 * owner, gone when the dialog closes (it lives only in the action result).
 */
function ClaimLinkDialog({
  state,
  onClose,
  onRetry,
}: {
  state: ClaimState | null
  onClose: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const { formatDateTime } = useDisplayFormat()
  const { copied, copyFailed, copy } = useCopyFeedback()
  // "Email me this link instead" — the SAME token goes out by mail; no second
  // certificate is minted and the per-user budget is untouched.
  const emailFetcher = useFetcher<SettingsResult>()
  // The dialog swallows the page behind it, so the send outcome (success or
  // "link not found") has to be announced from here.
  useFetcherToast(emailFetcher, { render: (d) => certToast(d, t) })
  const emailing = emailFetcher.state !== "idle"
  const emailed = emailFetcher.data != null && "certSent" in emailFetcher.data

  const title =
    state?.kind === "cooldown"
      ? t("devices.qr.cooldownTitle")
      : state?.kind === "error"
        ? t("devices.qr.errorTitle")
        : t("devices.qr.title")

  return (
    <Dialog.Root
      open={state !== null}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <Dialog.Portal size="sm">
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {state?.kind === "cooldown" && (
            <Stack gap="md">
              <Text as="p">
                {t("devices.qr.cooldownBody", {
                  time: formatDateTime(state.nextAvailable),
                  limit: NEW_DEVICE_LIMIT,
                })}
              </Text>
            </Stack>
          )}

          {state?.kind === "error" && (
            <Stack gap="md">
              <Alert variant="error">{state.message}</Alert>
              <Inline gap="sm" align="center">
                <Button variant="secondary" size="small" onClick={onRetry}>
                  {t("devices.qr.retry")}
                </Button>
              </Inline>
            </Stack>
          )}

          {(state?.kind === "pending" || state?.kind === "ready") && (
            <Stack gap="md" align="center">
              <Text as="p" variant="bodySm" color="muted">
                {state.kind === "ready" ? t("devices.qr.hint") : t("devices.qr.preparing")}
              </Text>
              {/* The placeholder occupies exactly the QR's footprint, so the
                  code appears in place instead of shoving the dialog around.
                  The Spinner takes no `label`: the visible line above already
                  says it, and the DS renders that label sr-only, so passing it
                  would announce the same sentence twice. */}
              <html.div style={styles.qrSlot}>
                {state.kind === "ready" ? (
                  <QrCode value={state.claimUrl} label={t("devices.qr.alt")} size={QR_SIZE} />
                ) : (
                  <Spinner size="lg" />
                )}
              </html.div>
              <Inline gap="sm" align="center">
                <Button
                  variant="secondary"
                  size="small"
                  disabled={state.kind !== "ready"}
                  onClick={() => state.kind === "ready" && copy(state.claimUrl)}
                >
                  {copyFailed ? t("devices.qr.copyFailed") : copied ? t("devices.qr.copied") : t("devices.qr.copyLink")}
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  disabled={state.kind !== "ready" || emailing || emailed}
                  onClick={() => {
                    if (state.kind === "ready")
                      emailFetcher.submit(
                        { intent: "emailRevealLink", revealToken: state.revealToken },
                        { method: "post", action: API_URL },
                      )
                  }}
                >
                  {emailed
                    ? t("devices.qr.emailSent")
                    : emailing
                      ? t("devices.qr.emailing")
                      : t("devices.qr.emailInstead")}
                </Button>
              </Inline>
              <Text as="p" variant="bodySm" color="muted">
                {state.kind === "ready" ? t("devices.qr.expiry", { time: formatDateTime(state.expiresAt) }) : null}
              </Text>
              <Text as="p" variant="bodySm" color="muted">
                {t("devices.qr.nameHint")}
              </Text>
            </Stack>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="primary" onClick={onClose}>
            {state?.kind === "ready" ? t("common.done") : t("common.close")}
          </Button>
        </Dialog.Footer>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ExpiryBadge({ expiresAt }: { expiresAt: string }) {
  const { t } = useTranslation()
  const status = expiryStatus(expiresAt)
  if (status === "expired") {
    return (
      <Badge variant="error" size="sm">
        {t("devices.list.expired")}
      </Badge>
    )
  }
  if (status === "imminent") {
    return (
      <Badge variant="error" size="sm">
        {t("devices.list.expiresInDays", { count: Math.max(daysUntil(expiresAt), 0) })}
      </Badge>
    )
  }
  if (status === "soon") {
    return (
      <Badge variant="warning" size="sm">
        {t("devices.list.expiresInDays", { count: daysUntil(expiresAt) })}
      </Badge>
    )
  }
  return null
}

/**
 * Revoke control, shared by a device's current certificate and the ones it
 * superseded. `revokeState` is the only trace a failed revocation leaves —
 * nothing retries in the background — so the retry has to be offered here.
 */
function RevokeCell({ cert, onRevoked }: { cert: UserCertificate; onRevoked: () => void }) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const fetcher = useFetcher<SettingsResult>()
  useFetcherToast(fetcher, { render: (d) => certToast(d, t) })
  const isSubmitting = fetcher.state !== "idle"

  // The revalidation a revoke triggers drops the row from the loader data
  // anyway; telling the parent lets it hide until that lands.
  const [handled, setHandled] = useState<SettingsResult | undefined>(undefined)
  if (fetcher.data !== handled) {
    setHandled(fetcher.data)
    if (fetcher.data != null && "certRevoked" in fetcher.data) onRevoked()
  }

  if (confirming) {
    return (
      <Inline gap="sm">
        <fetcher.Form method="post" action={API_URL}>
          <html.input type="hidden" name="intent" value="revokeCert" />
          <html.input type="hidden" name="serialNumber" value={cert.serialNumber} />
          <Button type="submit" variant="danger" size="small" disabled={isSubmitting}>
            {isSubmitting ? t("devices.list.revoking") : t("devices.list.revokeYes")}
          </Button>
        </fetcher.Form>
        <Button variant="secondary" size="small" onClick={() => setConfirming(false)}>
          {t("common.cancel")}
        </Button>
      </Inline>
    )
  }
  if (cert.revokeState === "pending") {
    return (
      <Text variant="bodySm" color="muted">
        {t("devices.list.revoking")}
      </Text>
    )
  }
  return (
    <Button variant="danger" size="small" onClick={() => setConfirming(true)}>
      {cert.revokeState === "failed" ? t("devices.list.revokeFailed") : t("devices.list.revoke")}
    </Button>
  )
}

/**
 * A certificate that a renewal replaced. It stays usable until the
 * replacement's reveal link is opened, so it is shown — muted, beneath its
 * device — rather than hidden: the user may still have it installed, and
 * revoking it by hand is the only way out if the renewal email was lost.
 */
function SupersededRow({ cert }: { cert: UserCertificate }) {
  const { t } = useTranslation()
  const { formatDate } = useDisplayFormat()
  const [revoked, setRevoked] = useState(false)

  if (revoked) return null

  return (
    <Table.Row>
      <Table.Cell>
        <Text as="span" color="muted" variant="bodySm">
          {t("devices.replaced")}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Tooltip.Root content={cert.serialNumber}>
          <Tooltip.Trigger>
            <Text as="span" variant="code">
              {cert.serialNumber.slice(-8)}
            </Text>
          </Tooltip.Trigger>
        </Tooltip.Root>
      </Table.Cell>
      <Table.Cell>
        <Text as="span" color="muted" variant="bodySm">
          {formatDate(cert.issuedAt)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text as="span" color="muted" variant="bodySm">
          {formatDate(cert.expiresAt)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <RevokeCell cert={cert} onRevoked={() => setRevoked(true)} />
      </Table.Cell>
    </Table.Row>
  )
}

function DeviceRow({ cert, certificates }: { cert: UserCertificate; certificates: UserCertificate[] }) {
  const { t } = useTranslation()
  const { formatDate, formatDateTime } = useDisplayFormat()
  const [renaming, setRenaming] = useState(false)
  const [revoked, setRevoked] = useState(false)
  // Optimistic device label: the submitted value shows while the rename is in
  // flight or once the server confirmed it — otherwise `cert.label` stays the
  // source of truth, so a loader revalidation can never render a stale label.
  const [pendingLabel, setPendingLabel] = useState<{ value: string | null } | null>(null)
  const fetcher = useFetcher<SettingsResult>()
  useFetcherToast(fetcher, { render: (d) => certToast(d, t) })
  const isSubmitting = fetcher.state !== "idle"
  const renamed = fetcher.data != null && "certRenamed" in fetcher.data
  const label = pendingLabel && (isSubmitting || renamed) ? pendingLabel.value : cert.label

  if (revoked) return null

  const status = expiryStatus(cert.expiresAt)
  const atRisk = status === "expired" || status === "imminent"
  const cooldownUntil = renewalCooldownUntil(cert, certificates)

  return (
    <Table.Row>
      <Table.Cell>
        {renaming ? (
          <fetcher.Form
            method="post"
            action={API_URL}
            onSubmit={(e) => {
              const fd = new FormData(e.currentTarget)
              const next = ((fd.get("label") as string) ?? "").trim() || null
              setPendingLabel({ value: next })
              setRenaming(false)
            }}
          >
            <html.input type="hidden" name="intent" value="renameCert" />
            <html.input type="hidden" name="serialNumber" value={cert.serialNumber} />
            <Inline gap="sm">
              <Input
                name="label"
                defaultValue={label ?? ""}
                placeholder={t("devices.devicePlaceholder")}
                maxLength={64}
              />
              <Button type="submit" variant="primary" size="small" disabled={isSubmitting}>
                {t("common.save")}
              </Button>
              <Button type="button" variant="secondary" size="small" onClick={() => setRenaming(false)}>
                {t("common.cancel")}
              </Button>
            </Inline>
          </fetcher.Form>
        ) : (
          <Inline gap="sm" align="center">
            {label ? (
              <Text as="span">{label}</Text>
            ) : (
              <Text as="span" color="muted">
                {t("devices.list.unnamed")}
              </Text>
            )}
            {/* UA-observed device kind, captured at claim time in its own
                column — survives renames, so "perso" is still knowably an
                iPhone. Hidden when it would just repeat the label. */}
            {cert.claimedPlatform && cert.claimedPlatform !== label && (
              <Text as="span" variant="bodySm" color="muted">
                {cert.claimedPlatform}
              </Text>
            )}
            <Button type="button" variant="link" size="small" onClick={() => setRenaming(true)}>
              {t("devices.list.rename")}
            </Button>
          </Inline>
        )}
      </Table.Cell>
      <Table.Cell>
        <Tooltip.Root content={cert.serialNumber}>
          <Tooltip.Trigger>
            <Text as="span" variant="code">
              {cert.serialNumber.slice(-8)}
            </Text>
          </Tooltip.Trigger>
        </Tooltip.Root>
      </Table.Cell>
      <Table.Cell>{formatDate(cert.issuedAt)}</Table.Cell>
      <Table.Cell>
        <Inline gap="sm">
          <Text as="span">{formatDate(cert.expiresAt)}</Text>
          <ExpiryBadge expiresAt={cert.expiresAt} />
        </Inline>
      </Table.Cell>
      <Table.Cell>
        <Stack gap="sm">
          <Inline gap="sm">
            <fetcher.Form method="post" action={API_URL}>
              <html.input type="hidden" name="intent" value="renewCert" />
              <html.input type="hidden" name="serialNumber" value={cert.serialNumber} />
              {/* Promoted only when the certificate is actually at risk — a
                  renew button competing with revoke on every healthy row is
                  noise, but on an expiring one it IS the next step. */}
              <Button
                type="submit"
                size="small"
                variant={atRisk ? "primary" : "secondary"}
                disabled={isSubmitting || cooldownUntil !== null}
              >
                {isSubmitting ? t("devices.renewing") : t("devices.renew")}
              </Button>
            </fetcher.Form>
            <RevokeCell cert={cert} onRevoked={() => setRevoked(true)} />
          </Inline>
          {cooldownUntil !== null && (
            <Text variant="bodySm" color="muted">
              {t("devices.renewNextAvailable", { time: formatDateTime(cooldownUntil) })}
            </Text>
          )}
        </Stack>
      </Table.Cell>
    </Table.Row>
  )
}

export function DevicesSection({
  budget,
  certificates,
  pendingClaim = null,
}: {
  /** Live new-device slots — see ~/lib/device-budget. */
  budget: DeviceBudget
  certificates: UserCertificate[]
  /** A device setup still waiting to be claimed — expiry only; the link
   *  itself is fetched by an explicit POST, never served in loader data. */
  pendingClaim?: { expiresAt: string } | null
}) {
  const { t } = useTranslation()
  const { formatDateTime } = useDisplayFormat()
  const fetcher = useFetcher<SettingsResult>()
  const [sort, setSort] = useState<DeviceSort>("name")

  const isSubmitting = fetcher.state !== "idle"
  const rows = sortDeviceRows(buildDeviceRows(certificates), sort)

  // One dialog session per click. `staleData` is whatever the fetcher was
  // holding when this session opened, so a previous session's answer is never
  // mistaken for this one's; `blockedUntil` is set when the click never
  // reached the server because the client already knew about the cooldown.
  // Both are frozen at open time — the revalidation that follows a successful
  // issue moves the cooldown forward, and a live read would flip an
  // already-open QR dialog into "come back tomorrow".
  const [session, setSession] = useState<{
    staleData: SettingsResult | undefined
    blockedUntil: string | null
  } | null>(null)

  const issue = () => {
    fetcher.submit({ intent: "issueCert", delivery: "link" }, { method: "post", action: API_URL })
  }

  // The button never swallows a click: the dialog opens first, and whatever
  // happens next (link, cooldown, failure) is shown there. Reading the
  // cooldown here rather than at render time keeps it honest to the moment of
  // the click without re-rendering on a timer.
  const openClaimDialog = () => {
    const full = budget.used >= budget.limit && budget.nextAvailable !== null
    setSession({ staleData: fetcher.data, blockedUntil: full ? budget.nextAvailable : null })
    if (!full) issue()
  }

  const retry = () => {
    setSession({ staleData: fetcher.data, blockedUntil: null })
    issue()
  }

  // Resume an interrupted setup: same certificate, fresh link, no budget
  // spent. Opens the same dialog so there is one place a claim link lives.
  const resumeClaim = () => {
    setSession({ staleData: fetcher.data, blockedUntil: null })
    fetcher.submit({ intent: "showClaimLink" }, { method: "post", action: API_URL })
  }

  // Only THIS session's answer counts — `fetcher.data` outlives the dialog.
  const sessionResult = session !== null && fetcher.data !== session.staleData ? fetcher.data : undefined
  const claimState: ClaimState | null =
    session === null
      ? null
      : session.blockedUntil !== null
        ? { kind: "cooldown", nextAvailable: session.blockedUntil }
        : sessionResult === undefined
          ? { kind: "pending" }
          : "certLinkReady" in sessionResult
            ? {
                kind: "ready",
                revealToken: sessionResult.revealToken,
                expiresAt: sessionResult.expiresAt,
                claimUrl: sessionResult.claimUrl,
              }
            : "rateLimited" in sessionResult
              ? { kind: "cooldown", nextAvailable: sessionResult.nextAvailable }
              : "certError" in sessionResult
                ? { kind: "error", message: sessionResult.certError }
                : "error" in sessionResult
                  ? { kind: "error", message: sessionResult.error }
                  : { kind: "pending" }

  // Ambient hint so the limit is visible BEFORE the click too; the dialog is
  // what explains it after one.
  const atLimit = budget.used >= budget.limit && budget.nextAvailable !== null

  return (
    <CardSection
      title={t("devices.heading")}
      // Adding a device is what this page is for, so its control sits in the
      // section header where it is always in the same place — not under a list
      // whose length varies, where it drifts off-screen as devices accumulate.
      action={
        // ONE click: issuing is the whole point of the button, so it issues —
        // the QR dialog that follows is the confirmation surface (and offers
        // "email me this link" for the same token). Cooldown still gates it.
        <Button variant="primary" disabled={isSubmitting} onClick={openClaimDialog}>
          {t("devices.newCert")}
        </Button>
      }
    >
      <Stack gap="md">
        <Text as="p" color="muted">
          {t("devices.description")}
        </Text>

        {atLimit && budget.nextAvailable !== null && (
          <Text as="p" variant="bodySm" color="muted">
            {t("devices.nextAvailable", { time: formatDateTime(budget.nextAvailable) })}
          </Text>
        )}

        {/* The link outlives the dialog that showed it: closing the QR used to
            strand a perfectly good setup server-side while the user was told
            to wait a day. */}
        {pendingClaim !== null && (
          <Alert variant="info">
            <Stack gap="sm">
              <Text as="p">{t("devices.pending.body", { time: formatDateTime(pendingClaim.expiresAt) })}</Text>
              <Inline gap="sm">
                <Button variant="secondary" size="small" onClick={resumeClaim}>
                  {t("devices.pending.action")}
                </Button>
              </Inline>
            </Stack>
          </Alert>
        )}

        <ClaimLinkDialog state={claimState} onClose={() => setSession(null)} onRetry={retry} />

        {rows.length > 0 && (
          <>
            <Inline gap="sm" align="center">
              <Text as="span" variant="bodySm" color="muted">
                {t("devices.sort.label")}
              </Text>
              <ToggleGroup size="small" value={[sort]} onValueChange={(v) => setSort((v[0] as DeviceSort) ?? "name")}>
                <Toggle value="name">{t("devices.sort.name")}</Toggle>
                <Toggle value="expiry">{t("devices.sort.expiry")}</Toggle>
              </ToggleGroup>
            </Inline>
            <ScrollArea.Root>
              <ScrollArea.Viewport>
                <ScrollArea.Content>
                  <Table.Root>
                    <Table.Header>
                      <Table.Row>
                        <Table.HeaderCell>{t("devices.list.device")}</Table.HeaderCell>
                        <Table.HeaderCell>{t("devices.list.serial")}</Table.HeaderCell>
                        <Table.HeaderCell>{t("devices.list.issued")}</Table.HeaderCell>
                        <Table.HeaderCell>{t("devices.list.expires")}</Table.HeaderCell>
                        <Table.HeaderCell>{t("common.actions")}</Table.HeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {rows.map((row) => (
                        <Fragment key={row.current.id}>
                          <DeviceRow cert={row.current} certificates={certificates} />
                          {row.superseded.map((old) => (
                            <SupersededRow key={old.id} cert={old} />
                          ))}
                        </Fragment>
                      ))}
                    </Table.Body>
                  </Table.Root>
                </ScrollArea.Content>
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar orientation="horizontal">
                <ScrollArea.Thumb orientation="horizontal" />
              </ScrollArea.Scrollbar>
            </ScrollArea.Root>
          </>
        )}

        {rows.length === 0 && (
          <Text as="p" color="muted" variant="bodySm">
            {t("devices.list.empty")}
          </Text>
        )}
      </Stack>
    </CardSection>
  )
}
