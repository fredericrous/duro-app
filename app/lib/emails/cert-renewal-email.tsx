import { Body, Container, Head, Heading, Html, Preview, Section, Text, Hr } from "@react-email/components"

export function CertRenewalEmail() {
  return (
    <Html>
      <Head />
      <Preview>Your Daddyshome certificate has been renewed</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>Certificate Renewed</Heading>

          <Text style={text}>
            Your security certificate for Daddyshome has been renewed. A new certificate is attached to this email as{" "}
            <strong>certificate.p12</strong>.
          </Text>

          <Hr style={hr} />

          <Section style={section}>
            <Heading as="h2" style={subheading}>
              Install Your New Certificate
            </Heading>
            <Text style={text}>
              Please install this certificate to continue accessing Daddyshome services. You may need to remove the old
              certificate first.
            </Text>

            <Text style={textSmall}>
              <strong>macOS:</strong> Double-click the .p12 file to open Keychain Access, enter the password when
              prompted, then trust the certificate. You can remove the old certificate from Keychain Access.
            </Text>
            <Text style={textSmall}>
              <strong>Windows:</strong> Double-click the .p12 file, follow the Certificate Import Wizard, and enter the
              password when prompted. You can remove the old certificate from the Certificate Manager.
            </Text>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            This is an automated renewal. Your account and access remain unchanged — only the certificate has been
            updated. If you didn't expect this, please contact your administrator.
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

const footer = {
  color: "#666",
  fontSize: "12px",
  lineHeight: "1.5",
  margin: "0",
}
