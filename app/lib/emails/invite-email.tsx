"use no memo"

import { Body, Container, Head, Heading, Html, Link, Preview, Section, Text, Button, Hr } from "@react-email/components"
import type { TFunction } from "i18next"

interface InviteEmailProps {
  inviteUrl: string
  reinviteUrl: string
  invitedBy: string
  appName: string
  appDescription: string
  t: TFunction
}

export function InviteEmail({ inviteUrl, reinviteUrl, invitedBy, appName, appDescription, t }: InviteEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{t("email.invite.preview", { appName })}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>{t("email.invite.heading", { appName })}</Heading>

          <Text style={text}>{t("email.invite.body", { invitedBy, appName, appDescription })}</Text>

          <Hr style={hr} />

          <Section style={section}>
            <Heading as="h2" style={subheading}>
              {t("email.invite.step1.title")}
            </Heading>
            <Text style={text} dangerouslySetInnerHTML={{ __html: t("email.invite.step1.body") }} />
            <Text style={textSmall} dangerouslySetInnerHTML={{ __html: t("email.invite.step1.macos") }} />
            <Text style={textSmall} dangerouslySetInnerHTML={{ __html: t("email.invite.step1.windows") }} />
          </Section>

          <Section style={section}>
            <Heading as="h2" style={subheading}>
              {t("email.invite.step2.title")}
            </Heading>
            <Text style={text}>{t("email.invite.step2.body")}</Text>
          </Section>

          <Section style={buttonContainer}>
            <Button style={button} href={inviteUrl}>
              {t("email.invite.cta")}
            </Button>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            {t("email.invite.footer", { reinviteUrl }).split("<a").length > 1 ? (
              <span dangerouslySetInnerHTML={{ __html: t("email.invite.footer", { reinviteUrl }) }} />
            ) : (
              <>
                {t("email.invite.footer", { reinviteUrl })}{" "}
                <Link href={reinviteUrl} style={footerLink}>
                  Request one here
                </Link>
              </>
            )}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const main = {
  backgroundColor: "#0f0f0f",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: "40px 0",
}

const container = {
  backgroundColor: "#1a1a1a",
  border: "1px solid #333",
  borderRadius: "12px",
  margin: "0 auto",
  maxWidth: "520px",
  padding: "40px 32px",
}

const heading = {
  color: "#e5e5e5",
  fontSize: "24px",
  fontWeight: "700" as const,
  margin: "0 0 16px",
}

const subheading = {
  color: "#e5e5e5",
  fontSize: "16px",
  fontWeight: "600" as const,
  margin: "0 0 8px",
}

const text = {
  color: "#e5e5e5",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0 0 12px",
}

const textSmall = {
  color: "#aaa",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 8px",
}

const section = {
  margin: "24px 0",
}

const hr = {
  borderColor: "#333",
  margin: "24px 0",
}

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
}

const button = {
  backgroundColor: "#3b82f6",
  borderRadius: "8px",
  color: "#fff",
  display: "inline-block",
  fontSize: "14px",
  fontWeight: "600" as const,
  padding: "12px 32px",
  textDecoration: "none",
}

const footer = {
  color: "#666",
  fontSize: "12px",
  lineHeight: "1.5",
  margin: "0",
}

const footerLink = {
  color: "#3b82f6",
  textDecoration: "underline",
}
