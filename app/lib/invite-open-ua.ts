/**
 * Classify the User-Agent that fetched an invite open-tracking pixel.
 *
 * Email open-tracking is noisy: Gmail and Apple Mail proxy/pre-fetch remote
 * images on delivery, so a pixel hit from one of those proxies means "delivered
 * + auto-loaded", not "a human opened it". We surface that distinction in the
 * admin UI instead of presenting every hit as a genuine open.
 *
 * - "proxy"   → a known mail-image proxy / privacy pre-fetcher (likely auto-load)
 * - "human"   → a recognizable end-user browser/mail client (likely a real open)
 * - "unknown" → no UA, or one we don't recognize
 */
export type OpenSource = "proxy" | "human" | "unknown"

// Known mail-image proxies and privacy pre-fetchers. Matched case-insensitively.
const PROXY_PATTERNS = [
  "googleimageproxy", // Gmail image proxy (GoogleImageProxy)
  "ggpht.com", // Google user-content proxy host sometimes in UA
  "via ggpht", // Gmail proxy variant
  "yahoomailproxy", // Yahoo Mail proxy
  "yahoo! slurp", // Yahoo fetcher
  "outlook", // Outlook/Office safe-link & image fetchers
  "microsoft office", // Office image prefetch
  "skypeuripreview", // Microsoft link/image preview
  "mailproxy",
  "imageproxy",
  "applemailprivacy", // Apple Mail Privacy Protection (some headers)
  "mailprivacyprotection",
  "proofpoint", // corporate mail-security scanners
  "barracuda",
  "mimecast",
]

// Recognizable end-user clients — a hit from these is more likely a real open.
const HUMAN_PATTERNS = [
  "mozilla", // most desktop/mobile browsers & many mail clients embed this
  "applewebkit",
  "chrome",
  "safari",
  "firefox",
  "edg/", // Edge
  "thunderbird",
  "iphone",
  "ipad",
  "android",
  "macintosh",
  "windows nt",
]

export function classifyOpenUA(userAgent: string | null | undefined): OpenSource {
  if (!userAgent) return "unknown"
  const ua = userAgent.toLowerCase()

  // Proxy detection wins — Apple/Gmail proxies sometimes also carry a browser
  // token, but the proxy signature is the more honest read of the hit.
  if (PROXY_PATTERNS.some((p) => ua.includes(p))) return "proxy"
  if (HUMAN_PATTERNS.some((p) => ua.includes(p))) return "human"
  return "unknown"
}
