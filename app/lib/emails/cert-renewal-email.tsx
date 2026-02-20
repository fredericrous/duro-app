"use no memo"

import { Body, Container, Head, Heading, Html, Preview, Section, Text, Hr } from "@react-email/components"
import type { TFunction } from "i18next"

interface CertRenewalEmailProps {
  appName: string
  t: TFunction
}

export function CertRenewalEmail({ appName, t }: CertRenewalEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{t("email.renewal.preview", { appName })}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>{t("email.renewal.heading")}</Heading>

          <Text style={text} dangerouslySetInnerHTML={{ __html: t("email.renewal.body", { appName }) }} />

          <Hr style={hr} />

          <Section style={section}>
            <Heading as="h2" style={subheading}>
              {t("email.renewal.install.title")}
            </Heading>
            <Text style={text}>
              {t("email.renewal.install.body", { appName })}
            </Text>

            <Text style={textSmall} dangerouslySetInnerHTML={{ __html: t("email.renewal.install.macos") }} />
            <Text style={textSmall} dangerouslySetInnerHTML={{ __html: t("email.renewal.install.windows") }} />
          </Section>

          <Hr style={hr} />

          <Text style={footer}>{t("email.renewal.footer")}</Text>
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

const footer = {
  color: "#666",
  fontSize: "12px",
  lineHeight: "1.5",
  margin: "0",
}
