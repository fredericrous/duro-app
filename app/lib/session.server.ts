import * as jose from "jose"

const SESSION_COOKIE = "__duro_session"
const PKCE_COOKIE = "__duro_pkce"
const SESSION_TTL = 8 * 3600 // 8 hours

function getKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters")
  }
  return new TextEncoder().encode(secret.slice(0, 32))
}

export interface SessionData {
  sub: string
  name: string
  email: string
  groups: string[]
}

export async function createSessionCookie(data: SessionData): Promise<string> {
  const key = getKey()
  const token = await new jose.EncryptJWT(data as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL}s`)
    .encrypt(key)

  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL}`
}

export async function getSession(request: Request): Promise<SessionData | null> {
  const value = parseCookie(request.headers.get("cookie"), SESSION_COOKIE)
  if (!value) return null

  try {
    const key = getKey()
    const { payload } = await jose.jwtDecrypt(value, key)
    return payload as unknown as SessionData
  } catch {
    return null
  }
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

// PKCE state cookie

export interface PkceData {
  codeVerifier: string
  state: string
  returnUrl: string
}

export async function createPkceCookie(data: PkceData): Promise<string> {
  const key = getKey()
  const token = await new jose.EncryptJWT(data as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .encrypt(key)

  return `${PKCE_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=600`
}

export async function getPkceData(request: Request): Promise<PkceData | null> {
  const value = parseCookie(request.headers.get("cookie"), PKCE_COOKIE)
  if (!value) return null

  try {
    const key = getKey()
    const { payload } = await jose.jwtDecrypt(value, key)
    return payload as unknown as PkceData
  } catch {
    return null
  }
}

export function clearPkceCookie(): string {
  return `${PKCE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0`
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match?.[1] ?? null
}
