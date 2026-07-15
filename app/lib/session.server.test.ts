// @vitest-environment node
import { describe, it, expect, beforeAll, afterEach } from "vitest"
import * as jose from "jose"
import {
  createSessionCookie,
  getSession,
  clearSessionCookie,
  createPkceCookie,
  getPkceData,
  clearPkceCookie,
  type SessionData,
  type PkceData,
} from "./session.server"

const SECRET = "test-session-secret-must-be-32ch"

beforeAll(() => {
  process.env.SESSION_SECRET = SECRET
})

afterEach(() => {
  process.env.SESSION_SECRET = SECRET
})

const SESSION_COOKIE = "__duro_session"
const PKCE_COOKIE = "__duro_pkce"

// Extracts "name=value" (drops the attributes) from a Set-Cookie string.
function nameValue(setCookie: string): string {
  return setCookie.split(";")[0]
}

function requestWithCookie(cookie: string): Request {
  return new Request("http://localhost/", { headers: { cookie } })
}

const sampleSession: SessionData = {
  sub: "user-123",
  name: "alice",
  email: "alice@example.com",
  groups: ["lldap_admin", "media_users"],
}

describe("session cookie round-trip", () => {
  it("mints a session cookie that parses back to the same fields", async () => {
    const setCookie = await createSessionCookie(sampleSession)
    expect(setCookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true)
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("Secure")
    expect(setCookie).toContain("SameSite=Lax")

    const req = requestWithCookie(nameValue(setCookie))
    const session = await getSession(req)
    expect(session).not.toBeNull()
    expect(session!.sub).toBe(sampleSession.sub)
    expect(session!.name).toBe(sampleSession.name)
    expect(session!.email).toBe(sampleSession.email)
    expect(session!.groups).toEqual(sampleSession.groups)
  })

  it("returns null when no session cookie is present", async () => {
    const req = requestWithCookie("something_else=abc")
    expect(await getSession(req)).toBeNull()
  })

  it("clearSessionCookie emits a Max-Age=0 expiry cookie", () => {
    const cleared = clearSessionCookie()
    expect(cleared.startsWith(`${SESSION_COOKIE}=;`)).toBe(true)
    expect(cleared).toContain("Max-Age=0")
  })
})

describe("SESSION_SECRET handling", () => {
  it("throws when the secret is shorter than 32 characters", async () => {
    process.env.SESSION_SECRET = "too-short"
    await expect(createSessionCookie(sampleSession)).rejects.toThrow("SESSION_SECRET must be at least 32 characters")
  })

  it("throws when the secret is missing entirely", async () => {
    delete process.env.SESSION_SECRET
    await expect(createSessionCookie(sampleSession)).rejects.toThrow("SESSION_SECRET must be at least 32 characters")
  })

  it("derives the key from the first 32 chars (longer secrets share a prefix)", async () => {
    // A secret that shares the first 32 chars with SECRET must decrypt a token
    // minted under SECRET, since getKey() slices to 32 bytes.
    const setCookie = await createSessionCookie(sampleSession)
    process.env.SESSION_SECRET = SECRET + "-extra-suffix-ignored"
    const session = await getSession(requestWithCookie(nameValue(setCookie)))
    expect(session).not.toBeNull()
    expect(session!.sub).toBe(sampleSession.sub)
  })
})

describe("expiry", () => {
  it("rejects an expired session token (returns null)", async () => {
    // Mint a token with the same key derivation but an expiration in the past.
    const key = new TextEncoder().encode(SECRET.slice(0, 32))
    const expired = await new jose.EncryptJWT(sampleSession as unknown as jose.JWTPayload)
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .encrypt(key)

    const req = requestWithCookie(`${SESSION_COOKIE}=${expired}`)
    expect(await getSession(req)).toBeNull()
  })
})

describe("tampering", () => {
  it("returns null for a garbage cookie value rather than throwing", async () => {
    const req = requestWithCookie(`${SESSION_COOKIE}=not-a-real-jwe`)
    expect(await getSession(req)).toBeNull()
  })

  it("returns null when the token is truncated/corrupted", async () => {
    const setCookie = await createSessionCookie(sampleSession)
    const token = nameValue(setCookie).slice(`${SESSION_COOKIE}=`.length)
    // Corrupt the ciphertext by chopping the tail.
    const corrupted = token.slice(0, token.length - 5)
    const req = requestWithCookie(`${SESSION_COOKIE}=${corrupted}`)
    expect(await getSession(req)).toBeNull()
  })
})

describe("cookie parser", () => {
  it("extracts the right value among multiple cookies", async () => {
    const setCookie = await createSessionCookie(sampleSession)
    const sessionPair = nameValue(setCookie)
    const cookie = `foo=1; ${sessionPair}; bar=2`
    const session = await getSession(requestWithCookie(cookie))
    expect(session).not.toBeNull()
    expect(session!.sub).toBe(sampleSession.sub)
  })

  it("does not match a cookie whose name is a suffix of the target", async () => {
    // "x__duro_session=..." must not be mistaken for "__duro_session=...".
    const setCookie = await createSessionCookie(sampleSession)
    const token = nameValue(setCookie).slice(`${SESSION_COOKIE}=`.length)
    const req = requestWithCookie(`x${SESSION_COOKIE}=${token}`)
    expect(await getSession(req)).toBeNull()
  })

  it("returns null when the target cookie is absent", async () => {
    const req = requestWithCookie("a=1; b=2; c=3")
    expect(await getSession(req)).toBeNull()
  })
})

describe("PKCE cookie helpers", () => {
  const pkce: PkceData = {
    codeVerifier: "verifier-abc-123",
    state: "state-xyz-789",
    returnUrl: "/dashboard?tab=settings",
  }

  it("round-trips PKCE data through create/parse", async () => {
    const setCookie = await createPkceCookie(pkce)
    expect(setCookie.startsWith(`${PKCE_COOKIE}=`)).toBe(true)
    expect(setCookie).toContain("Path=/auth")

    const parsed = await getPkceData(requestWithCookie(nameValue(setCookie)))
    expect(parsed).not.toBeNull()
    expect(parsed!.codeVerifier).toBe(pkce.codeVerifier)
    expect(parsed!.state).toBe(pkce.state)
    expect(parsed!.returnUrl).toBe(pkce.returnUrl)
  })

  it("returns null when the PKCE cookie is absent", async () => {
    expect(await getPkceData(requestWithCookie("nope=1"))).toBeNull()
  })

  it("returns null for a tampered PKCE cookie", async () => {
    expect(await getPkceData(requestWithCookie(`${PKCE_COOKIE}=garbage`))).toBeNull()
  })

  it("clearPkceCookie emits a Max-Age=0 expiry cookie scoped to /auth", () => {
    const cleared = clearPkceCookie()
    expect(cleared.startsWith(`${PKCE_COOKIE}=;`)).toBe(true)
    expect(cleared).toContain("Max-Age=0")
    expect(cleared).toContain("Path=/auth")
  })
})
