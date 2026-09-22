// @vitest-environment node
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseXfccCert, canonicalSerial, isIssuedBy } from "./client-cert.server"

// Throwaway self-signed cert (serial 0x0A1B2C3D4E5F) — NOT a credential, only a
// parsing fixture. Its leading-zero nibble exercises ASN.1 zero-padding.
const FIXTURE_PEM = readFileSync(
  fileURLToPath(new URL("../test/fixtures/client-cert-fixture.pem", import.meta.url)),
  "utf8",
)
const FIXTURE_CANON = "a1b2c3d4e5f"

// Public certificates only (no keys are committed): a client-CA-like RSA root
// and its leaf, an impostor root with the SAME subject DN and a leaf it
// signed, and an EC break-glass-like root and its leaf.
const trustFixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../test/fixtures/xfcc-trust/${name}.pem`, import.meta.url)), "utf8")
const CLIENT_CA = trustFixture("client-ca")
const LEAF_CLIENT_CA = trustFixture("leaf-client-ca")
const IMPOSTOR_CA = trustFixture("impostor-ca")
const LEAF_IMPOSTOR_CA = trustFixture("leaf-impostor-ca")
const BREAKGLASS_CA = trustFixture("breakglass-ca")
const LEAF_BREAKGLASS_CA = trustFixture("leaf-breakglass-ca")

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

describe("parseXfccCert — key types and PEM", () => {
  it("parses an EC certificate (node-forge could not) and returns its PEM", () => {
    const parsed = parseXfccCert(xfcc(LEAF_BREAKGLASS_CA))
    expect(parsed).not.toBeNull()
    expect(canonicalSerial(parsed!.serial)).toBe("d1e2f3061")
    expect(parsed!.pem).toContain("BEGIN CERTIFICATE")
  })

  it("returns the RSA leaf's PEM unchanged for issuer checks", () => {
    const parsed = parseXfccCert(xfcc(LEAF_CLIENT_CA))
    expect(canonicalSerial(parsed!.serial)).toBe("b1c2d3e4f")
    expect(isIssuedBy(parsed!.pem, CLIENT_CA)).toBe(true)
  })
})

describe("isIssuedBy", () => {
  it("accepts a leaf the CA signed", () => {
    expect(isIssuedBy(LEAF_CLIENT_CA, CLIENT_CA)).toBe(true)
    expect(isIssuedBy(LEAF_BREAKGLASS_CA, BREAKGLASS_CA)).toBe(true)
  })

  it("rejects a leaf from a different CA that has the SAME subject DN", () => {
    // A name comparison would accept this; the signature check must not.
    expect(isIssuedBy(LEAF_IMPOSTOR_CA, CLIENT_CA)).toBe(false)
    expect(isIssuedBy(LEAF_CLIENT_CA, IMPOSTOR_CA)).toBe(false)
  })

  it("rejects a break-glass leaf against the client CA, and vice versa", () => {
    expect(isIssuedBy(LEAF_BREAKGLASS_CA, CLIENT_CA)).toBe(false)
    expect(isIssuedBy(LEAF_CLIENT_CA, BREAKGLASS_CA)).toBe(false)
  })

  it("returns false (never throws) on garbage input", () => {
    expect(isIssuedBy("not-a-pem", CLIENT_CA)).toBe(false)
    expect(isIssuedBy(LEAF_CLIENT_CA, "not-a-pem")).toBe(false)
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
