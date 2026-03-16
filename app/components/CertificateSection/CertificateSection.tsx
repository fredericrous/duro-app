import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import type { SettingsResult } from "~/lib/mutations/settings"
import { useAction } from "~/hooks/useAction"
import { PasswordReveal } from "~/components/PasswordReveal/PasswordReveal"
import { Alert, Button, Inline, ScrollArea, Stack, Table, Text } from "@duro-app/ui"

const API_URL = "/settings"

function CertRow({ cert }: { cert: UserCertificate }) {
  const { t } = useTranslation()
  const action = useAction<SettingsResult>(API_URL)
  const [confirming, setConfirming] = useState(false)
  const isSubmitting = action.state !== "idle"
  const revoked = action.data && "certRevoked" in action.data

  if (revoked) return null

  const serialShort = cert.serialNumber.slice(-8)

  return (
    <Table.Row>
      <Table.Cell>
        <code title={cert.serialNumber} style={{ fontFamily: "monospace" }}>
          {serialShort}
        </code>
      </Table.Cell>
      <Table.Cell>{new Date(cert.issuedAt).toLocaleDateString()}</Table.Cell>
      <Table.Cell>{new Date(cert.expiresAt).toLocaleDateString()}</Table.Cell>
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
                <Table.Root columns={4}>
                  <Table.Header>
                    <Table.Row>
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
            <Inline gap="sm">
              <certAction.Form>
                <input type="hidden" name="intent" value="issueCert" />
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? t("settings.cert.issuing") : t("settings.cert.confirmButton")}
                </Button>
              </certAction.Form>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t("common.cancel")}
              </Button>
            </Inline>
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
