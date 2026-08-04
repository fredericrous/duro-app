import type { UserCertificate } from "~/lib/services/CertificateRepo.server"

/**
 * Devices are not a stored entity — a certificate IS a device, identified by
 * its user-supplied label. Renewal is the one case where a single device holds
 * more than one certificate: the replacement and, until its reveal link is
 * opened, the cert it supersedes. This module turns the flat cert list into
 * that shape so the UI can show one row per device.
 */
export interface DeviceRowModel {
  /** The cert the device is actually using — the newest in its renewal chain. */
  current: UserCertificate
  /** Older certs of the same device, newest first; each still awaiting revocation. */
  superseded: UserCertificate[]
}

export type DeviceSort = "name" | "expiry"

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * Group certs into devices by walking renewal chains backwards from their head.
 *
 * `renewedFromSerial` is not a foreign key and the list is filtered to
 * unrevoked certs, so a pointer can dangle or (in principle) cycle. Every walk
 * is bounded by a visited set, and anything a walk never reached is emitted as
 * its own device — a malformed chain must degrade to extra rows, never to a
 * certificate the user cannot see or revoke.
 */
export function buildDeviceRows(certs: UserCertificate[]): DeviceRowModel[] {
  const bySerial = new Map(certs.map((c) => [c.serialNumber, c]))
  const supersededSerials = new Set(
    certs.map((c) => c.renewedFromSerial).filter((s): s is string => s !== null && s !== undefined),
  )

  const emitted = new Set<string>()
  const rows: DeviceRowModel[] = []

  const walk = (head: UserCertificate): DeviceRowModel => {
    const superseded: UserCertificate[] = []
    emitted.add(head.serialNumber)
    let cursor = head
    while (cursor.renewedFromSerial) {
      const prev = bySerial.get(cursor.renewedFromSerial)
      if (!prev || emitted.has(prev.serialNumber)) break
      emitted.add(prev.serialNumber)
      superseded.push(prev)
      cursor = prev
    }
    return { current: head, superseded }
  }

  // Heads first: a cert nothing else claims to replace is the live one.
  for (const cert of certs) {
    if (!supersededSerials.has(cert.serialNumber)) rows.push(walk(cert))
  }
  // Anything left is part of a cycle and has no head — surface it standalone.
  for (const cert of certs) {
    if (!emitted.has(cert.serialNumber)) rows.push(walk(cert))
  }

  return rows
}

export function sortDeviceRows(rows: DeviceRowModel[], sort: DeviceSort): DeviceRowModel[] {
  const byExpiry = (a: DeviceRowModel, b: DeviceRowModel) =>
    new Date(a.current.expiresAt).getTime() - new Date(b.current.expiresAt).getTime() ||
    a.current.serialNumber.localeCompare(b.current.serialNumber)

  if (sort === "expiry") return [...rows].sort(byExpiry)

  return [...rows].sort((a, b) => {
    const aLabel = a.current.label
    const bLabel = b.current.label
    // Unnamed devices sink to the bottom: they carry no information to sort on,
    // and a wall of "Unnamed device" at the top buries the ones you can identify.
    if (aLabel && bLabel) return aLabel.localeCompare(bLabel) || byExpiry(a, b)
    if (aLabel) return -1
    if (bLabel) return 1
    return byExpiry(a, b)
  })
}

/**
 * When this cert may next be renewed, or null if it may be renewed now.
 *
 * Mirrors the server's per-device rate limit (see handleRenewCert) so the
 * button can disable itself, but the server stays authoritative: a successor
 * the user already revoked is absent from the loader's list, so the server can
 * still answer `rateLimited` where this returns null. The UI renders both.
 */
export function renewalCooldownUntil(cert: UserCertificate, certs: UserCertificate[]): number | null {
  // A renewal makes the NEW cert the one carrying the renew button, and it has
  // no successor of its own — so gating on successors alone would let a chain
  // be extended indefinitely, one cert at a time. The cert must also have
  // settled for a day before it can be replaced.
  let newest = new Date(cert.issuedAt).getTime()
  for (const c of certs) {
    if (c.renewedFromSerial !== cert.serialNumber) continue
    const issued = new Date(c.issuedAt).getTime()
    if (issued > newest) newest = issued
  }
  const until = newest + ONE_DAY_MS
  return Date.now() < until ? until : null
}
