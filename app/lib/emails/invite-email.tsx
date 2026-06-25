"use no memo"

import { EmailShell, Heading, Text, Button, Hr, Section, Link, Img } from "@duro-app/ui-email"
import { Trans } from "react-i18next/TransWithoutContext"
import type { TFunction } from "i18next"

interface InviteEmailProps {
  inviteUrl: string
  reinviteUrl: string
  invitedBy: string
  appName: string
  appDescription: string
  /** Click-tracking redirector for the CTA. Falls back to inviteUrl when absent. */
  clickUrl?: string
  /** Open-tracking pixel URL. When omitted, no pixel is rendered. */
  pixelUrl?: string
  t: TFunction
}

export function InviteEmail({
  inviteUrl,
  reinviteUrl,
  invitedBy,
  appName,
  appDescription,
  clickUrl,
  pixelUrl,
  t,
}: InviteEmailProps) {
  return (
    <EmailShell preview={t("email.invite.preview", { appName })}>
      <Heading>{t("email.invite.heading", { appName })}</Heading>

      <Text>{t("email.invite.body", { invitedBy, appName, appDescription })}</Text>

      <Hr />

      <Section>
        <Heading as="h2">{t("email.invite.step1.title")}</Heading>
        <Text>
          <Trans t={t} i18nKey="email.invite.step1.body" components={{ strong: <strong /> }} />
        </Text>
        <Text variant="small">
          <Trans t={t} i18nKey="email.invite.step1.macos" components={{ strong: <strong /> }} />
        </Text>
        <Text variant="small">
          <Trans t={t} i18nKey="email.invite.step1.windows" components={{ strong: <strong /> }} />
        </Text>
      </Section>

      <Section>
        <Heading as="h2">{t("email.invite.step2.title")}</Heading>
        <Text>{t("email.invite.step2.body")}</Text>
      </Section>

      <Button href={clickUrl ?? inviteUrl}>{t("email.invite.cta")}</Button>

      <Hr />

      <Text variant="footer">
        <Trans
          t={t}
          i18nKey="email.invite.footer"
          values={{ reinviteUrl }}
          components={{ a: <Link href={reinviteUrl} /> }}
        />
      </Text>

      {/* Open-tracking pixel — a real (not display:none) 1x1 image; some
          clients/proxies skip hidden images. Kept visually inert. */}
      {pixelUrl ? (
        <Img
          src={pixelUrl}
          width="1"
          height="1"
          alt=""
          style={{ display: "block", border: 0, opacity: 0, maxHeight: "1px", maxWidth: "1px" }}
        />
      ) : null}
    </EmailShell>
  )
}
