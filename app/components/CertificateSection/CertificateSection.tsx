import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import type { SettingsResult } from "~/lib/mutations/settings"
import { useAction } from "~/hooks/useAction"
import { PasswordReveal } from "~/components/PasswordReveal/PasswordReveal"
import { Alert, Badge, Button, Inline, Input, ScrollArea, Stack, Table, Text } from "@duro-app/ui"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function expiryStatus(expiresAt: string): "ok" | "soon" | "imminent" | "expired" {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / ONE_DAY_MS)
  if (days <= 0) return "expired"
  if (days <= 7) return "imminent"
  if (days <= 30) return "soon"
  return "ok"
}

function daysUntil(expiresAt: string): number {
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / ONE_DAY_MS)
}

// Cert actions live on the certificate settings sub-route now.
const API_URL = "/settings/certificate"

function CertRow({ cert }: { cert: UserCertificate }) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const [renaming, setRenaming] = useState(false)
  // Optimistic device label so the row reflects a rename immediately (useAction
  // is a plain fetch, no router revalidation); reverts on a full page reload.
  const [label, setLabel] = useState(cert.label)
  const action = useAction<SettingsResult>(API_URL)
  const isSubmitting = action.state !== "idle"
  const revoked = action.data && "certRevoked" in action.data

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
              void action.submit(fd)
              setLabel(next)
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
      <Table.Cell>{new Date(cert.issuedAt).toLocaleDateString()}</Table.Cell>
      <Table.Cell>
        <Inline gap="sm">
          <Text as="span">{new Date(cert.expiresAt).toLocaleDateString()}</Text>
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
            <action.Form>
              <input type="hidden" name="intent" value="revokeCert" />
              <input type="hidden" name="serialNumber" value={cert.serialNumber} />
              <Button type="submit" variant="danger" size="small" disabled={isSubmitting}>
                {isSubmitting ? t("settings.cert.list.revoking") : t("settings.cert.list.revokeYes")}
              </Button>
            </action.Form>
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
  p12Password,
  lastCertRenewalAt,
  certificates,
}: {
  email: string | null
  p12Password: string | null
  lastCertRenewalAt: string | null
  certificates: UserCertificate[]
}) {
  const { t } = useTranslation()
  const certAction = useAction<SettingsResult>(API_URL)
  const [confirming, setConfirming] = useState(false)

  const certData = certAction.data
  const isSubmitting = certAction.state !== "idle"

  // Password from action response (immediate, no race) or from loader
  const effectivePassword =
    certData && "p12Password" in certData && certData.p12Password ? certData.p12Password : p12Password

  // After successful issuance, clear scratch state so card is fresh
  useEffect(() => {
    if (certData && "certSent" in certData) {
      try {
        localStorage.removeItem("scratch:/settings")
      } catch {
        // localStorage may be unavailable
      }
    }
  }, [certData])

  const justSent = certData && "certSent" in certData

  // Rate limit check — computed once on mount to avoid impure Date.now() during render
  const isRateLimited = certData && "rateLimited" in certData
  const [cooldownState] = useState(() => {
    let cooldown = false
    let text = ""
    if (lastCertRenewalAt) {
      const elapsed = Date.now() - new Date(lastCertRenewalAt).getTime()
      const twentyFourHours = 24 * 60 * 60 * 1000
      if (elapsed < twentyFourHours) {
        cooldown = true
        text = new Date(new Date(lastCertRenewalAt).getTime() + twentyFourHours).toLocaleString()
      }
    }
    return { cooldown, text }
  })
  let { cooldown: cooldownRemaining, text: nextAvailableText } = cooldownState
  if (isRateLimited && certData.nextAvailable) {
    cooldownRemaining = true
    nextAvailableText = new Date(certData.nextAvailable).toLocaleString()
  }

  return (
    <Stack gap="md">
      <Text as="p" color="muted">
        {t("settings.cert.description")}
      </Text>

      {certData && "certError" in certData && <Alert variant="error">{certData.certError}</Alert>}

      {justSent && <Alert variant="success">{t("settings.cert.success")}</Alert>}

      {certData && "certRevoked" in certData && <Alert variant="success">{t("settings.cert.list.revoked")}</Alert>}

      {effectivePassword && <PasswordReveal p12Password={effectivePassword} />}

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

      {certificates.length === 0 && !effectivePassword && (
        <Text as="p" color="muted" variant="bodySm">
          {t("settings.cert.list.empty")}
        </Text>
      )}

      {cooldownRemaining && !effectivePassword ? (
        <Stack gap="sm">
          <Button disabled>{t("settings.cert.newCert")}</Button>
          <Text as="p" variant="bodySm" color="muted">
            {t("settings.cert.nextAvailable", { time: nextAvailableText })}
          </Text>
        </Stack>
      ) : confirming ? (
        <Stack gap="sm">
          <Text as="p">{t("settings.cert.confirm", { email })}</Text>
          <certAction.Form>
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
          </certAction.Form>
        </Stack>
      ) : (
        !effectivePassword && (
          <Button variant="primary" onClick={() => setConfirming(true)}>
            {t("settings.cert.newCert")}
          </Button>
        )
      )}
    </Stack>
  )
}
