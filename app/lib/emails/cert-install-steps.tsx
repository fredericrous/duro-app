"use no memo"

import { Text } from "@duro-app/ui-email"
import { Trans } from "react-i18next/TransWithoutContext"
import type { TFunction } from "i18next"

/**
 * Per-platform .p12 install steps, shared by the invite and renewal emails.
 *
 * An email has no reliable way to tell which device will open it, so every
 * platform is listed. The Firefox line is last and deliberately phrased as a
 * question rather than a platform: Firefox reads its own certificate store on
 * every desktop OS, so following the macOS or Windows line alone leaves a
 * Firefox user with a certificate their browser will never present.
 */
export function CertInstallSteps({ t }: { t: TFunction }) {
  return (
    <>
      {(["android", "ios", "macos", "windows", "firefox"] as const).map((platform) => (
        <Text key={platform} variant="small">
          <Trans t={t} i18nKey={`certInstall.${platform}`} components={{ strong: <strong /> }} />
        </Text>
      ))}
    </>
  )
}
