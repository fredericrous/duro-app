// @vitest-environment node
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseXfccCert, canonicalSerial } from "./client-cert.server"

// Throwaway self-signed cert (serial 0x0A1B2C3D4E5F) — NOT a credential, only a
// parsing fixture. Its leading-zero nibble exercises ASN.1 zero-padding.
const FIXTURE_PEM = readFileSync(
  fileURLToPath(new URL("../test/fixtures/client-cert-fixture.pem", import.meta.url)),
  "utf8",
)
const FIXTURE_CANON = "a1b2c3d4e5f"

/** Build an XFCC header the way Envoy's SanitizeSet does. */
const xfcc = (pem: string, extra = "") =>
  `${extra}By=spiffe://cluster/duro;Hash=deadbeef;Subject="CN=fixture@example.com,O=Test";Cert="${encodeURIComponent(pem)}"`

describe("parseXfccCert", () => {
  it("extracts the serial from a single Envoy element", () => {
    expect(parseXfccCert(xfcc(FIXTURE_PEM))?.serial).toBeTruthy()
    expect(canonicalSerial(parseXfccCert(xfcc(FIXTURE_PEM))!.serial)).toBe(FIXTURE_CANON)
  })

  it("is not fooled by commas and '=' inside a quoted Subject DN", () => {
    // A naive comma-split would break the element apart here.
    const header = `By=x;Subject="CN=a,OU=b,O=c=d";Cert="${encodeURIComponent(FIXTURE_PEM)}"`
    expect(canonicalSerial(parseXfccCert(header)!.serial)).toBe(FIXTURE_CANON)
  })

  it("reads the cert from a multi-element (multi-hop) header", () => {
    const header = `${xfcc(FIXTURE_PEM)},By=other;Hash=aa;Subject="CN=proxy"`
    expect(canonicalSerial(parseXfccCert(header)!.serial)).toBe(FIXTURE_CANON)
  })

  it("returns null for absent, empty, or cert-less headers", () => {
    expect(parseXfccCert(null)).toBeNull()
    expect(parseXfccCert(undefined)).toBeNull()
    expect(parseXfccCert("")).toBeNull()
    expect(parseXfccCert('By=x;Hash=aa;Subject="CN=nobody"')).toBeNull()
  })

  it("returns null (never throws) on a malformed Cert value", () => {
    expect(parseXfccCert('Cert="not-a-pem"')).toBeNull()
    expect(
      parseXfccCert(`Cert="${encodeURIComponent("-----BEGIN CERTIFICATE-----\ngarbage\n-----END CERTIFICATE-----")}"`),
    ).toBeNull()
  })
})

describe("canonicalSerial", () => {
  it("collapses separators, case, and ASN.1 leading-zero padding to one value", () => {
    expect(canonicalSerial("0A1B2C3D4E5F")).toBe(FIXTURE_CANON) // openssl (uppercase, padded)
    expect(canonicalSerial("0a1b2c3d4e5f")).toBe(FIXTURE_CANON) // forge (lowercase, padded)
    expect(canonicalSerial("0a:1b:2c:3d:4e:5f")).toBe(FIXTURE_CANON) // vault (colon-hex)
    expect(canonicalSerial("a1b2c3d4e5f")).toBe(FIXTURE_CANON) // already minimal
  })

  it("preserves internal zeros and never empties a real serial", () => {
    expect(canonicalSerial("0a00ff")).toBe("a00ff")
    expect(canonicalSerial("00")).toBe("0")
  })
})
