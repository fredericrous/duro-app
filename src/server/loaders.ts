/**
 * Re-exports of server-side utilities for use in Expo Router loaders.
 *
 * This file lives outside src/app/ so the Babel server-data-loaders plugin
 * does NOT strip its exports when bundling loader-only bundles.
 * Import from here in loaders instead of directly from ~/lib/*.server.
 */
export { getSession, createSessionCookie, clearSessionCookie } from "~/lib/session.server"
export { requireAuth, getAuth, type AuthInfo } from "~/lib/auth.server"
export { runEffect } from "~/lib/runtime.server"
export { config } from "~/lib/config.server"
export { hashToken } from "~/lib/crypto.server"
export { resolveLocale } from "~/lib/i18n.server"

// Service tags (for use inside Effect.gen)
export { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
export { CertManager } from "~/lib/services/CertManager.server"
export { CertificateRepo } from "~/lib/services/CertificateRepo.server"
export { UserManager } from "~/lib/services/UserManager.server"
export { InviteRepo } from "~/lib/services/InviteRepo.server"
