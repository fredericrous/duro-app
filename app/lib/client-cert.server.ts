import { X509Certificate } from "node:crypto"

/**
 * Read a client certificate out of the Envoy `x-forwarded-client-cert` (XFCC)
 * header and expose its serial number.
 *
 * `home.daddyshome.fr` terminates mTLS at the gateway with
 * `clientValidation.optional: false`, and the ClientTrafficPolicy forwards the
 * cert with `xForwardedClientCert.mode: SanitizeSet` — meaning Envoy STRIPS any
 * client-supplied XFCC and sets its own from the verified handshake. So a value
 * reaching this code describes a certificate the TLS layer already validated
 * against the listener's trust bundle — which may hold more than one root, so
 * use `isIssuedBy` before trusting WHICH CA issued it. Never parse a
 * client-supplied cert header on a listener without that guarantee.
 *
 * XFCC grammar (Envoy): comma-separated elements, one per proxy hop; each is
 * `Key=Value;Key=Value`; a value is double-quoted with `\"` escapes when it
 * contains `,`, `;` or `=` (Subject and Cert always are). A naive comma split
 * breaks on the commas inside a quoted Subject DN, so we tokenize quote-aware.
 * Under SanitizeSet there is exactly one element, but we stay robust.
 */

/** Split a `Key=Value;Key=Value` element into pairs, honoring double quotes. */
function parseElement(element: string): Map<string, string> {
  const out = new Map<string, string>()
  let i = 0
  const n = element.length
  while (i < n) {
    // key
    let key = ""
    while (i < n && element[i] !== "=" && element[i] !== ";") key += element[i++]
    if (i < n && element[i] === ";") {
      i++
      continue
    } // stray key with no value
    if (i >= n) break
    i++ // consume '='
    // value — quoted or bare
    let value = ""
    if (element[i] === '"') {
      i++ // opening quote
      while (i < n) {
        const c = element[i]
        if (c === "\\" && i + 1 < n) {
          value += element[i + 1]
          i += 2
          continue
        }
        if (c === '"') {
          i++
          break
        }
        value += c
        i++
      }
    } else {
      while (i < n && element[i] !== ";") value += element[i++]
    }
    out.set(key.trim().toLowerCase(), value)
    if (i < n && element[i] === ";") i++
  }
  return out
}

/** Split the XFCC header into elements on unquoted commas. */
function splitElements(header: string): string[] {
  const elements: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < header.length; i++) {
    const c = header[i]
    if (c === "\\" && inQuotes && i + 1 < header.length) {
      cur += c + header[i + 1]
      i++
      continue
    }
    if (c === '"') {
      inQuotes = !inQuotes
      cur += c
      continue
    }
    if (c === "," && !inQuotes) {
      elements.push(cur)
      cur = ""
      continue
    }
    cur += c
  }
  if (cur.trim() !== "") elements.push(cur)
  return elements
}

/**
 * Extract the presented client certificate's serial (and its PEM, for issuer
 * checks) from an XFCC header. Returns null when the header is absent,
 * malformed, or carries no parseable `Cert=` PEM. Never throws on bad input — a parse failure is "no cert", not a
 * 500. Callers MUST NOT log the raw header or the decoded certificate body.
 */
export function parseXfccCert(xfcc: string | null | undefined): { serial: string; pem: string } | null {
  if (!xfcc) return null
  try {
    for (const element of splitElements(xfcc)) {
      const pairs = parseElement(element)
      const certValue = pairs.get("cert")
      if (!certValue) continue
      // The Cert value is a URL-encoded PEM. node:crypto parses RSA and EC
      // certificates alike; node-forge could not read an EC key, so an EC
      // cert used to fall through to "no cert" by accident rather than design.
      const pem = decodeURIComponent(certValue)
      const cert = new X509Certificate(pem)
      if (cert.serialNumber) return { serial: cert.serialNumber, pem }
    }
  } catch {
    return null
  }
  return null
}

/**
 * Did the client CA sign this certificate? A cryptographic check — issuer name
 * AND signature — never a name comparison: two CAs can share a subject DN.
 * Envoy only admits certificates chaining to a CA in its trust bundle, and that
 * bundle can hold more than one root (the break-glass CA is trusted on
 * `home.daddyshome.fr` alongside the client CA), so "Envoy verified it" does
 * not mean "the client CA issued it". Invite resolution keys on a serial that
 * is only unique within one issuer, hence this guard. Never throws.
 */
export function isIssuedBy(certPem: string, caPem: string): boolean {
  try {
    const cert = new X509Certificate(certPem)
    const ca = new X509Certificate(caPem)
    return cert.checkIssued(ca) && cert.verify(ca.publicKey)
  } catch {
    return false
  }
}

/**
 * Canonical integer form of an X.509 serial, so representations that differ only
 * in separators, case, or ASN.1 leading-zero padding compare equal:
 * lowercase, strip non-hex (colons), drop leading zeros. `0x0a1b` and `0xa1b`
 * both become `a1b`. The SQL twin is `ltrim(lower(replace(serial_number,
 * ':', '')), '0')` (migration 0036 / findBySerialCanonical) — keep them in step.
 */
export function canonicalSerial(hex: string): string {
  const stripped = hex
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .replace(/^0+/, "")
  return stripped === "" ? "0" : stripped
}
