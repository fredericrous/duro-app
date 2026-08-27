import { useTranslation } from "react-i18next"
import { Button, Callout, Heading, LinkButton, Stack, Text } from "@duro-app/ui"
import { useCopyFeedback } from "~/hooks/useCopyFeedback"

/**
 * The dead end made legible: this browser has no client-certificate store, so
 * the cert probe can never pass here no matter how many times the visitor
 * reloads. Every affordance on this card is about reaching a browser that can
 * finish the flow, because nothing in this one will.
 */
export function UnsupportedBrowser({
  onIos,
  inviteUrl,
  chromeUrl,
}: {
  onIos: boolean
  inviteUrl?: string
  chromeUrl?: string | null
}) {
  const { t } = useTranslation()
  const { copied, copyFailed, copy } = useCopyFeedback()

  return (
    <Stack gap="sm">
      <Callout variant="error" icon="alert-triangle" align="start">
        <Stack gap="xs">
          <Heading level={2} variant="headingSm">
            {t("invite.cert.unsupported.title")}
          </Heading>
          <Text as="p">{t(onIos ? "invite.cert.unsupported.ios" : "invite.cert.unsupported.android")}</Text>
        </Stack>
      </Callout>
      {/* An intent:// link is the only one-tap way out of Firefox for Android,
          but it is Android-only and an OEM can refuse it — so the copyable URL
          is always offered alongside it, never instead of it. */}
      {chromeUrl ? (
        <LinkButton href={chromeUrl} variant="primary" fullWidth>
          {t("invite.cert.unsupported.openChrome")}
        </LinkButton>
      ) : null}
      {inviteUrl ? (
        <Button variant="secondary" fullWidth onClick={() => copy(inviteUrl)}>
          {copied ? t("invite.cert.unsupported.copied") : t("invite.cert.unsupported.copyLink")}
        </Button>
      ) : null}
      {copyFailed ? (
        <Text as="p" color="muted" variant="bodySm">
          {t("invite.cert.unsupported.copyFailed")}
        </Text>
      ) : null}
    </Stack>
  )
}
