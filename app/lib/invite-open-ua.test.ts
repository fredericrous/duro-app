import { describe, it, expect } from "vitest"
import { classifyOpenUA } from "./invite-open-ua"

describe("classifyOpenUA", () => {
  it("returns 'unknown' for missing UA", () => {
    expect(classifyOpenUA(null)).toBe("unknown")
    expect(classifyOpenUA(undefined)).toBe("unknown")
    expect(classifyOpenUA("")).toBe("unknown")
  })

  it("flags known mail-image proxies as 'proxy'", () => {
    expect(
      classifyOpenUA("Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)"),
    ).toBe("proxy")
    expect(classifyOpenUA("GoogleImageProxy")).toBe("proxy")
    expect(classifyOpenUA("Mozilla/5.0 ... MailPrivacyProtection")).toBe("proxy")
    expect(classifyOpenUA("YahooMailProxy/1.0")).toBe("proxy")
    expect(classifyOpenUA("Microsoft Office Outlook")).toBe("proxy")
  })

  it("treats recognizable end-user clients as 'human'", () => {
    expect(classifyOpenUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Safari/605")).toBe("human")
    expect(classifyOpenUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("human")
    expect(classifyOpenUA("Mozilla/5.0 (X11; Linux) Chrome/120.0")).toBe("human")
    expect(classifyOpenUA("Mozilla/5.0 Thunderbird/115.0")).toBe("human")
  })

  it("returns 'unknown' for unrecognized agents", () => {
    expect(classifyOpenUA("curl/8.1.2")).toBe("unknown")
    expect(classifyOpenUA("some-random-bot/0.1")).toBe("unknown")
  })

  it("prefers 'proxy' even when a browser token is also present", () => {
    // Gmail's proxy UA carries a Firefox token but is still a proxy.
    expect(classifyOpenUA("Mozilla/5.0 Firefox/11.0 (via ggpht.com GoogleImageProxy)")).toBe("proxy")
  })
})
