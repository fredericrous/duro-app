import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import type { SettingsResult } from "~/lib/mutations/settings"
import { useAction } from "~/hooks/useAction"
import { PasswordReveal } from "~/components/PasswordReveal/PasswordReveal"
import { Alert, Button, Heading, Text } from "@duro-app/ui"
import styles from "~/routes/settings.module.css"

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
    <tr>
      <td title={cert.serialNumber}>
        <code>{serialShort}</code>
      </td>
      <td>{new Date(cert.issuedAt).toLocaleDateString()}</td>
      <td>{new Date(cert.expiresAt).toLocaleDateString()}</td>
      <td>
        {confirming ? (
          <div className={styles.confirmButtons}>
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
          </div>
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
      </td>
    </tr>
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

  // Rate limit check
  const isRateLimited = certData && "rateLimited" in certData
  let cooldownRemaining = false
  let nextAvailableText = ""
  if (lastCertRenewalAt) {
    const elapsed = Date.now() - new Date(lastCertRenewalAt).getTime()
    const twentyFourHours = 24 * 60 * 60 * 1000
    if (elapsed < twentyFourHours) {
      cooldownRemaining = true
      nextAvailableText = new Date(new Date(lastCertRenewalAt).getTime() + twentyFourHours).toLocaleString()
    }
  }
  if (isRateLimited && certData.nextAvailable) {
    cooldownRemaining = true
    nextAvailableText = new Date(certData.nextAvailable).toLocaleString()
  }

  return (
    <div className={styles.certSection}>
      <Heading level={2}>{t("settings.cert.heading")}</Heading>
      <Text as="p" color="muted">
        {t("settings.cert.description")}
      </Text>

      {certData && "certError" in certData && <Alert variant="error">{certData.certError}</Alert>}

      {justSent && <Alert variant="success">{t("settings.cert.success")}</Alert>}

      {certData && "certRevoked" in certData && (
        <Alert variant="success">{t("settings.cert.list.revoked")}</Alert>
      )}

      {effectivePassword && <PasswordReveal p12Password={effectivePassword} />}

      {certificates.length > 0 && (
        <div className={styles.certTableContainer}>
          <table className={styles.certTable}>
            <thead>
              <tr>
                <th>{t("settings.cert.list.serial")}</th>
                <th>{t("settings.cert.list.issued")}</th>
                <th>{t("settings.cert.list.expires")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {certificates.map((cert) => (
                <CertRow key={cert.id} cert={cert} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {certificates.length === 0 && !effectivePassword && (
        <Text as="p" color="muted" variant="bodySm">
          {t("settings.cert.list.empty")}
        </Text>
      )}

      {cooldownRemaining && !effectivePassword ? (
        <div>
          <Button disabled>{t("settings.cert.newCert")}</Button>
          <Text as="p" variant="bodySm" color="muted">
            {t("settings.cert.nextAvailable", { time: nextAvailableText })}
          </Text>
        </div>
      ) : confirming ? (
        <div className={styles.confirmRow}>
          <Text as="p">{t("settings.cert.confirm", { email })}</Text>
          <div className={styles.confirmButtons}>
            <certAction.Form>
              <input type="hidden" name="intent" value="issueCert" />
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? t("settings.cert.issuing") : t("settings.cert.confirmButton")}
              </Button>
            </certAction.Form>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        !effectivePassword && (
          <Button variant="primary" onClick={() => setConfirming(true)}>
            {t("settings.cert.newCert")}
          </Button>
        )
      )}
    </div>
  )
}
