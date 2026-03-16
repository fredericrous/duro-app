/**
 * Dev fallback data for Expo Router loaders.
 *
 * Metro's Babel server-data-loaders plugin strips dynamic imports of *.server
 * modules in dev loader bundles. Loaders must catch the resulting errors and
 * return fallback data so the page can render. The actual business logic runs
 * through Effect layers via the API routes (mutations), which work correctly.
 */

const devAuth = { user: "dev", isAdmin: true } as const

export const devHomeFallback = {
  ...devAuth,
  visibleApps: [],
  categoryOrder: [],
}

export const devSettingsFallback = {
  ...devAuth,
  locale: "en",
  currentLocale: "en",
  email: "dev@localhost",
  lastCertRenewalAt: null,
  p12Password: null,
  certificates: [],
}

export const devInviteFallback = {
  valid: true as const,
  email: "dev@localhost",
  groupNames: ["family"],
  p12Password: "dev-p12-password",
  appName: "Duro",
  healthUrl: "/health",
}

export const devCreateAccountFallback = {
  valid: true as const,
  email: "dev@localhost",
  appName: "Duro",
  healthUrl: "/health",
}
