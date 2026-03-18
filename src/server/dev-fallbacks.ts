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
  visibleApps: [
    {
      id: "jellyfin",
      name: "Jellyfin",
      url: "http://localhost:8096",
      category: "media",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>',
      groups: [],
      priority: 1,
    },
    {
      id: "navidrome",
      name: "Navidrome",
      url: "http://localhost:4533",
      category: "media",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
      groups: [],
      priority: 2,
    },
    {
      id: "vaultwarden",
      name: "Vaultwarden",
      url: "http://localhost:8080",
      category: "tools",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>',
      groups: [],
      priority: 1,
    },
  ],
  categoryOrder: ["media", "tools"],
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
