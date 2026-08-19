/**
 * Best-effort default device name from a user-agent string — used to prefill
 * the claim page's "name this device" field, because the device opening the
 * claim link IS the device being added. Product names, not OS versions: the
 * user recognises "iPhone", not "iOS 19.2". Always editable; null when the
 * UA says nothing recognisable.
 */
export function defaultDeviceName(userAgent: string): string | null {
  const ua = userAgent.toLowerCase()
  if (ua.includes("iphone")) return "iPhone"
  if (ua.includes("ipad")) return "iPad"
  if (ua.includes("android")) return "Android"
  if (ua.includes("cros")) return "Chromebook"
  if (ua.includes("macintosh") || ua.includes("mac os x")) return "Mac"
  if (ua.includes("windows")) return "Windows PC"
  if (ua.includes("linux")) return "Linux"
  return null
}
