/**
 * What a browser can do with an mTLS client certificate, read off the
 * User-Agent.
 *
 * The invite flow proves a certificate is installed by fetching an endpoint
 * behind mTLS: present the cert and the fetch succeeds. That probe has one
 * blind spot it cannot report on its own — a browser that will NEVER present a
 * certificate fails it in exactly the same way as one whose user simply hasn't
 * installed theirs yet. So the page says "not installed yet, check again",
 * forever, and the visitor has no way to tell that the browser, not their own
 * mistake, is the problem. The User-Agent is the only thing that separates the
 * two BEFORE the probe runs.
 *
 * - "none"   → no client-certificate support at all. Firefox for Android keeps
 *              its own NSS store rather than the Android credential store and
 *              ships no PKCS#12 import UI, so a .p12 installed system-wide —
 *              where Chrome finds it — is invisible to it. Firefox for iOS is
 *              a WKWebView that never answers the client-certificate
 *              challenge. Nothing the visitor does in these browsers can work.
 * - "own"    → supported, but only out of its own store. Desktop Firefox reads
 *              certificates imported through its own settings, never the OS
 *              keychain, so "double-click the .p12" — correct for Safari,
 *              Chrome and Edge — silently does nothing here.
 * - "system" → the OS keychain / Android credential store. Everything else.
 */
export type CertStore = "none" | "own" | "system"

/** OS the visitor is on, insofar as it changes how a .p12 gets installed. */
export type CertPlatform = "android" | "ios" | "macos" | "windows" | "linux"

export function certStore(userAgent: string | null | undefined): CertStore {
  const ua = (userAgent ?? "").toLowerCase()
  // Gecko desktop/Android both carry "firefox/"; iOS builds carry "fxios/"
  // because they are WKWebView wrappers, not Gecko.
  const isFirefox = ua.includes("firefox/") || ua.includes("fxios/")
  if (!isFirefox) return "system"

  const platform = certPlatform(ua)
  // An unrecognised platform stays "own" rather than "none": a wrong "none"
  // tells someone their working browser is hopeless, which is worse than a
  // wrong "own", which merely offers an extra instruction.
  return platform === "android" || platform === "ios" ? "none" : "own"
}

export function certPlatform(userAgent: string | null | undefined): CertPlatform | null {
  const ua = (userAgent ?? "").toLowerCase()
  // Order matters: Android UAs also say "linux", and iOS UAs also say
  // "like mac os x".
  if (ua.includes("android")) return "android"
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod") || ua.includes("fxios")) return "ios"
  if (ua.includes("windows")) return "windows"
  if (ua.includes("macintosh") || ua.includes("mac os x")) return "macos"
  if (ua.includes("linux") || ua.includes("cros")) return "linux"
  return null
}

/**
 * Android intent URL that reopens an https page in Chrome specifically.
 * Firefox for Android honours `intent://`, which is what makes this the one
 * link that can get a stranded visitor out of a browser that cannot finish the
 * flow — without asking them to retype an invite URL full of token.
 *
 * Returns null for anything that isn't an https URL, so a misconfigured base
 * URL yields no button rather than a broken one.
 */
export function chromeIntentUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:") return null
  return `intent://${parsed.host}${parsed.pathname}${parsed.search}#Intent;scheme=https;package=com.android.chrome;end`
}
