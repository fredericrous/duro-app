import * as crypto from "node:crypto"
import type { DeliveryStatus } from "~/lib/services/InviteRepo.server"

/**
 * Stalwart outbound-delivery webhook: signature verification + payload parsing.
 *
 * Pure (no Effect / no DB) so it's trivially unit-testable. Stalwart POSTs
 * `{ events: [{ id, createdAt, type, data }] }` and signs the raw body with
 * HMAC-SHA256, base64-encoded, in the `X-Signature` header.
 *
 * Event-name → status mapping is per https://stalw.art/docs/ref/events/ —
 * note `delivery.failed` is a *temporary* failure (retried), NOT a bounce.
 */

const DELIVERED = new Set(["delivery.delivered", "delivery.dsn-success"])

const BOUNCED = new Set([
  "delivery.rcpt-to-rejected",
  "delivery.message-rejected",
  "delivery.null-mx",
  "delivery.mx-lookup-failed",
  "delivery.dsn-perm-fail",
])

const DEFERRED = new Set([
  "delivery.failed",
  "delivery.connect-error",
  "delivery.rate-limit-exceeded",
  "delivery.dsn-temp-fail",
])

export function statusForEventType(type: string): DeliveryStatus | null {
  if (DELIVERED.has(type)) return "delivered"
  if (BOUNCED.has(type)) return "bounced"
  if (DEFERRED.has(type)) return "deferred"
  return null
}

/** Compute the base64 HMAC-SHA256 of a raw body with the given key. */
export function computeSignature(rawBody: string, key: string): string {
  return crypto.createHmac("sha256", key).update(rawBody).digest("base64")
}

/**
 * Constant-time check of the `X-Signature` header against the body. Returns
 * false for a missing/empty header or any mismatch — never throws.
 */
export function verifySignature(rawBody: string, header: string | null, key: string): boolean {
  if (!header) return false
  const expected = computeSignature(rawBody, key)
  const a = Buffer.from(expected)
  const b = Buffer.from(header)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export interface StalwartEvent {
  readonly type: string
  readonly data: Record<string, unknown>
}

export interface DeliveryUpdate {
  readonly status: DeliveryStatus
  /** Invite id parsed from our deterministic Message-ID, when present. */
  readonly inviteId: string | null
  /** Raw Message-ID from the event, for findByMessageId fallback. */
  readonly messageId: string | null
  /** Recipient address (lowercased), for findLatestByEmail fallback. */
  readonly recipient: string | null
  /** SMTP response / DSN reason, when present. */
  readonly detail: string | null
}

// Stalwart's delivery events (verified against v0.15.5 source,
// crates/smtp/src/outbound/session.rs) carry the recipient as `To` and the SMTP
// response text as `Details` — and NO message-id. So recipient email is the
// real correlation key; message-id is only matched opportunistically in case a
// future payload includes it. Field-name casing isn't guaranteed (docs use
// camelCase `to`, the Rust enum is `To`), so all lookups are case-INSENSITIVE.
const MESSAGE_ID_KEYS = ["messageid", "message-id", "message_id"]
const RECIPIENT_KEYS = ["to", "rcpt", "rcptto", "rcpt-to", "recipient"]
const DETAIL_KEYS = ["details", "detail", "response", "reason", "message", "code"]

/** Lowercase every top-level key so lookups are case-insensitive. */
function lowerKeys(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(data)) out[k.toLowerCase()] = data[k]
  return out
}

function firstString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = data[k]
    if (typeof v === "string" && v.length > 0) return v
    if (typeof v === "number") return String(v)
    // some payloads carry arrays (e.g. multiple recipients) — take the first
    if (Array.isArray(v) && typeof v[0] === "string" && v[0].length > 0) return v[0]
  }
  return null
}

/** Our deterministic Message-ID format is `<invite-{id}@suffix>`. */
export function inviteIdFromMessageId(messageId: string | null): string | null {
  if (!messageId) return null
  const m = messageId.match(/^<?invite-([^@>]+)@/)
  return m ? m[1] : null
}

/**
 * Parse a webhook body into delivery updates, one per relevant `delivery.*`
 * event. Events that don't map to a delivery status are dropped. Tolerant of
 * unknown shapes — returns [] rather than throwing.
 */
export function parseDeliveryUpdates(body: unknown): DeliveryUpdate[] {
  const events = (body as { events?: unknown })?.events
  if (!Array.isArray(events)) return []

  const updates: DeliveryUpdate[] = []
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue
    const type = (ev as StalwartEvent).type
    if (typeof type !== "string") continue
    const status = statusForEventType(type)
    if (!status) continue

    const data = lowerKeys(((ev as StalwartEvent).data ?? {}) as Record<string, unknown>)
    const messageId = firstString(data, MESSAGE_ID_KEYS)
    const recipientRaw = firstString(data, RECIPIENT_KEYS)
    updates.push({
      status,
      inviteId: inviteIdFromMessageId(messageId),
      messageId,
      recipient: recipientRaw ? recipientRaw.toLowerCase() : null,
      detail: firstString(data, DETAIL_KEYS),
    })
  }
  return updates
}
