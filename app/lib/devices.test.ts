import { describe, expect, it } from "vitest"
import { buildDeviceRows, renewalCooldownUntil, sortDeviceRows } from "./devices"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"

const DAY = 24 * 60 * 60 * 1000

const cert = (over: Partial<UserCertificate> & { serialNumber: string }): UserCertificate =>
  ({
    id: over.serialNumber,
    inviteId: null,
    userId: null,
    username: "alice",
    email: "alice@example.com",
    label: null,
    issuedAt: new Date(Date.now() - 30 * DAY).toISOString(),
    expiresAt: new Date(Date.now() + 60 * DAY).toISOString(),
    revokedAt: null,
    revokeState: null,
    revokeError: null,
    renewedFromSerial: null,
    ...over,
  }) as UserCertificate

const serials = (rows: ReturnType<typeof buildDeviceRows>) =>
  rows.map((r) => [r.current.serialNumber, ...r.superseded.map((s) => s.serialNumber)])

describe("buildDeviceRows", () => {
  it("treats each unrelated cert as its own device", () => {
    const rows = buildDeviceRows([cert({ serialNumber: "A" }), cert({ serialNumber: "B" })])
    expect(serials(rows)).toEqual([["A"], ["B"]])
  })

  it("collapses a renewal chain into one device, newest first", () => {
    const rows = buildDeviceRows([
      cert({ serialNumber: "C", renewedFromSerial: "B" }),
      cert({ serialNumber: "B", renewedFromSerial: "A" }),
      cert({ serialNumber: "A" }),
    ])
    expect(serials(rows)).toEqual([["C", "B", "A"]])
  })

  it("keeps a cert whose predecessor is already gone", () => {
    // The predecessor was revoked, so it never reaches the list — the survivor
    // still has to render as a normal device.
    const rows = buildDeviceRows([cert({ serialNumber: "B", renewedFromSerial: "GONE" })])
    expect(serials(rows)).toEqual([["B"]])
  })

  it("surfaces every cert even when the chain is a cycle", () => {
    // Not reachable through the app, but a cycle must degrade to extra rows
    // rather than hiding a cert the user still needs to revoke.
    const rows = buildDeviceRows([
      cert({ serialNumber: "A", renewedFromSerial: "B" }),
      cert({ serialNumber: "B", renewedFromSerial: "A" }),
    ])
    expect(rows.flatMap((r) => [r.current.serialNumber, ...r.superseded.map((s) => s.serialNumber)]).sort()).toEqual([
      "A",
      "B",
    ])
  })

  it("terminates on a cert that points at itself", () => {
    const rows = buildDeviceRows([cert({ serialNumber: "A", renewedFromSerial: "A" })])
    expect(serials(rows)).toEqual([["A"]])
  })
})

describe("sortDeviceRows", () => {
  const rows = () =>
    buildDeviceRows([
      cert({ serialNumber: "N1", label: "Zeta laptop", expiresAt: new Date(Date.now() + 90 * DAY).toISOString() }),
      cert({ serialNumber: "N2", label: "Alpha phone", expiresAt: new Date(Date.now() + 40 * DAY).toISOString() }),
      cert({ serialNumber: "U1", label: null, expiresAt: new Date(Date.now() + 10 * DAY).toISOString() }),
    ])

  it("sorts by name with unnamed devices last", () => {
    expect(sortDeviceRows(rows(), "name").map((r) => r.current.serialNumber)).toEqual(["N2", "N1", "U1"])
  })

  it("sorts by soonest expiry regardless of name", () => {
    expect(sortDeviceRows(rows(), "expiry").map((r) => r.current.serialNumber)).toEqual(["U1", "N2", "N1"])
  })

  it("does not mutate the input", () => {
    const input = rows()
    const before = input.map((r) => r.current.serialNumber)
    sortDeviceRows(input, "expiry")
    expect(input.map((r) => r.current.serialNumber)).toEqual(before)
  })
})

describe("renewalCooldownUntil", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString()

  it("returns the unlock time while a replacement is under 24h old", () => {
    const issuedAt = hoursAgo(1)
    const a = cert({ serialNumber: "A", issuedAt: hoursAgo(500) })
    const until = renewalCooldownUntil(a, [a, cert({ serialNumber: "B", renewedFromSerial: "A", issuedAt })])
    expect(until).toBe(new Date(issuedAt).getTime() + DAY)
  })

  it("returns null once both the cert and its replacement are older than 24h", () => {
    const a = cert({ serialNumber: "A", issuedAt: hoursAgo(500) })
    expect(
      renewalCooldownUntil(a, [a, cert({ serialNumber: "B", renewedFromSerial: "A", issuedAt: hoursAgo(25) })]),
    ).toBeNull()
  })

  it("returns null for a settled cert that has never been renewed", () => {
    const a = cert({ serialNumber: "A", issuedAt: hoursAgo(500) })
    expect(renewalCooldownUntil(a, [a])).toBeNull()
  })

  it("blocks a freshly issued cert, so a renewal chain cannot be extended on the spot", () => {
    // This is the case that makes the limit bite: renewing produces a new cert
    // with no successor of its own, which a successor-only check would leave
    // immediately renewable.
    const issuedAt = hoursAgo(2)
    const fresh = cert({ serialNumber: "B", renewedFromSerial: "A", issuedAt })
    expect(renewalCooldownUntil(fresh, [fresh])).toBe(new Date(issuedAt).getTime() + DAY)
  })

  it("uses the newest replacement when there are several", () => {
    const recent = hoursAgo(2)
    const a = cert({ serialNumber: "A", issuedAt: hoursAgo(500) })
    const until = renewalCooldownUntil(a, [
      a,
      cert({ serialNumber: "B", renewedFromSerial: "A", issuedAt: hoursAgo(40) }),
      cert({ serialNumber: "C", renewedFromSerial: "A", issuedAt: recent }),
    ])
    expect(until).toBe(new Date(recent).getTime() + DAY)
  })
})
