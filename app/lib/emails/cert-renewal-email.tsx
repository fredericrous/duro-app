"use no memo"

import { EmailShell, Heading, Text, Button, Hr, Section } from "@duro-app/ui-email"
import { Trans } from "react-i18next/TransWithoutContext"
import type { TFunction } from "i18next"

interface CertRenewalEmailProps {
  appName: string
  t: TFunction
  /** Scratch-card reveal link for the P12 password. Omitted only for legacy/dev paths. */
  revealUrl?: string
}

export function CertRenewalEmail({ appName, t, revealUrl }: CertRenewalEmailProps) {
  return (
    <EmailShell preview={t("email.renewal.preview", { appName })}>
      <Heading>{t("email.renewal.heading")}</Heading>

      <Text>
        <Trans t={t} i18nKey="email.renewal.body" values={{ appName }} components={{ strong: <strong /> }} />
      </Text>

      {revealUrl ? (
        <>
          <Text>{t("email.renewal.reveal.body")}</Text>
          <Button href={revealUrl}>{t("email.renewal.reveal.cta")}</Button>
        </>
      ) : null}

      <Hr />

      <Section>
        <Heading as="h2">{t("email.renewal.install.title")}</Heading>
        <Text>{t("email.renewal.install.body", { appName })}</Text>
        <Text variant="small">
          <Trans t={t} i18nKey="email.renewal.install.macos" components={{ strong: <strong /> }} />
        </Text>
        <Text variant="small">
          <Trans t={t} i18nKey="email.renewal.install.windows" components={{ strong: <strong /> }} />
        </Text>
      </Section>

      <Hr />

      <Text variant="footer">{t("email.renewal.footer")}</Text>
    </EmailShell>
  )
}
