import { describe, expect, it } from "vitest"
import { defaultDeviceName } from "./device-name"

describe("defaultDeviceName", () => {
  it.each([
    // iPadOS 13+ masquerades as Macintosh; the true-iPad UA still exists on older devices.
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "iPhone"],
    ["Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "iPad"],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36", "Android"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", "Chromebook"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", "Mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", "Windows PC"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", "Linux"],
  ])("recognises %s", (ua, expected) => {
    expect(defaultDeviceName(ua)).toBe(expected)
  })

  it("prefers the device over its OS tokens (iPhone UA also says 'like Mac OS X')", () => {
    expect(defaultDeviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15")).toBe(
      "iPhone",
    )
  })

  it("prefers Android over the Linux token every Android UA carries", () => {
    expect(defaultDeviceName("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36")).toBe("Android")
  })

  it("returns null for unrecognisable agents", () => {
    expect(defaultDeviceName("curl/8.6.0")).toBeNull()
    expect(defaultDeviceName("")).toBeNull()
  })
})
