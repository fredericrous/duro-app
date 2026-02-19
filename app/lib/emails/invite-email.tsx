"use no memo"

import { Body, Container, Head, Heading, Html, Link, Preview, Section, Text, Button, Hr } from "@react-email/components"

interface InviteEmailProps {
  inviteUrl: string
  reinviteUrl: string
  invitedBy: string
}

export function InviteEmail({ inviteUrl, reinviteUrl, invitedBy }: InviteEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>You've been invited to Daddyshome</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>Welcome to Daddyshome</Heading>

          <Text style={text}>
            {invitedBy} has invited you to join Daddyshome, a private platform for media, productivity, and more.
          </Text>

          <Hr style={hr} />

          <Section style={section}>
            <Heading as="h2" style={subheading}>
              Step 1: Install Your Certificate
            </Heading>
            <Text style={text}>
              Your security certificate is attached to this email as <strong>certificate.p12</strong>. You'll see the
              password to install it when you click the link below.
            </Text>

            <Text style={textSmall}>
              <strong>macOS:</strong> Double-click the .p12 file to open Keychain Access, enter the password when
              prompted, then trust the certificate.
            </Text>
            <Text style={textSmall}>
              <strong>Windows:</strong> Double-click the .p12 file, follow the Certificate Import Wizard, and enter the
              password when prompted.
            </Text>
          </Section>

          <Section style={section}>
            <Heading as="h2" style={subheading}>
              Step 2: Create Your Account
            </Heading>
            <Text style={text}>After installing your certificate, click the button below to create your account.</Text>
          </Section>

          <Section style={buttonContainer}>
            <Button style={button} href={inviteUrl}>
              Create Your Account
            </Button>
          </Section>

          <Hr style={hr} />

          <Text style={footer}>
            This link expires in 7 days. Need a new invite?{" "}
            <Link href={reinviteUrl} style={footerLink}>
              Request one here
            </Link>
            . If you didn't expect this invitation, you can safely ignore this email.
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
