import { describe, expect, it } from "vitest"
import { certPlatform, certStore, chromeIntentUrl } from "./cert-store"

const UA = {
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0",
  firefoxAndroidTablet: "Mozilla/5.0 (Android 14; Tablet; rv:126.0) Gecko/126.0 Firefox/126.0",
  firefoxIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/126.0 Firefox/126.0",
  firefoxWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/126.0 Firefox/126.0",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
}

describe("certStore", () => {
  it("reports no client-certificate support for Firefox on Android", () => {
    // The case this whole module exists for: the .p12 goes into the Android
    // credential store, Chrome sees it, Firefox never will.
    expect(certStore(UA.firefoxAndroid)).toBe("none")
    expect(certStore(UA.firefoxAndroidTablet)).toBe("none")
  })

  it("reports no client-certificate support for Firefox on iOS", () => {
    expect(certStore(UA.firefoxIos)).toBe("none")
  })

  it("reports desktop Firefox as using its own store, not the OS keychain", () => {
    expect(certStore(UA.firefoxMac)).toBe("own")
    expect(certStore(UA.firefoxWindows)).toBe("own")
  })

  it("reports the system store for every non-Firefox browser", () => {
    expect(certStore(UA.chromeAndroid)).toBe("system")
    expect(certStore(UA.safariIos)).toBe("system")
    expect(certStore(UA.chromeMac)).toBe("system")
    expect(certStore(UA.edgeWindows)).toBe("system")
  })

  it("assumes the system store when the User-Agent is missing or unreadable", () => {
    // Never strand a working browser on a guess — the probe still gets to run.
    expect(certStore(null)).toBe("system")
    expect(certStore(undefined)).toBe("system")
    expect(certStore("")).toBe("system")
    expect(certStore("curl/8.4.0")).toBe("system")
  })
})

describe("certPlatform", () => {
  it("picks Android over the Linux its User-Agent also claims", () => {
    expect(certPlatform(UA.chromeAndroid)).toBe("android")
  })

  it("picks iOS over the Mac its User-Agent also claims", () => {
    expect(certPlatform(UA.safariIos)).toBe("ios")
    expect(certPlatform(UA.firefoxIos)).toBe("ios")
  })

  it("recognises the desktop platforms", () => {
    expect(certPlatform(UA.chromeMac)).toBe("macos")
    expect(certPlatform(UA.edgeWindows)).toBe("windows")
    expect(certPlatform("Mozilla/5.0 (X11; Linux x86_64) Firefox/126.0")).toBe("linux")
  })

  it("returns null rather than guessing", () => {
    expect(certPlatform("curl/8.4.0")).toBeNull()
    expect(certPlatform(null)).toBeNull()
  })
})

describe("chromeIntentUrl", () => {
  it("rewrites an https invite link as a Chrome intent, token and all", () => {
    expect(chromeIntentUrl("https://join.example.com/invite/abc123")).toBe(
      "intent://join.example.com/invite/abc123#Intent;scheme=https;package=com.android.chrome;end",
    )
  })

  it("keeps the query string", () => {
    expect(chromeIntentUrl("https://join.example.com/invite/abc?lang=fr")).toContain("/invite/abc?lang=fr#Intent;")
  })

  it("refuses anything that is not https", () => {
    expect(chromeIntentUrl("http://join.example.com/invite/abc")).toBeNull()
    expect(chromeIntentUrl("not a url")).toBeNull()
  })
})
