// Client-safe surface for the settings → Git access mutation. The runtime
// handlers + form parser live in `./settings-git-keys.server.ts` (they need
// ForgejoClient + governance repos). GitKeysSection imports the validator from
// here so the textarea can pre-validate with EXACTLY the rules the server
// applies — client and server cannot drift because they call the same function.
//
// Keep this file free of `.server` imports (type-only imports are fine).
import type { AuthInfo } from "~/lib/auth.server"
import type { ForgejoFailure } from "~/lib/services/ForgejoClient.server"

/** Hard cap on keys per user — covers laptop+desktop+phone+a few dev boxes. */
export const MAX_SSH_KEYS = 10

export const MAX_TITLE_LENGTH = 100

/** OpenSSH public-key types we accept. `ssh-dss` is rejected as weak. */
export const SSH_KEY_TYPES = [
  "ssh-ed25519",
  "ssh-rsa",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
] as const

export type SshKeyValidationReason =
  | "private_key"
  | "multiline"
  | "too_long"
  | "bad_shape"
  | "unsupported_type"
  | "weak_algorithm"
  | "bad_base64"
  | "type_mismatch"
  | "title_required"
  | "title_too_long"

export type SshKeyValidation =
  | { ok: true; keyType: string; body: string; comment: string | null; normalized: string }
  | { ok: false; reason: SshKeyValidationReason }

/**
 * Validate a pasted OpenSSH public key. ORDER MATTERS: private-key detection
 * runs before everything else so a pasted secret is rejected without any
 * further processing — callers must never echo, log, store, or audit the
 * input when `reason === "private_key"`.
 *
 * Structural verification of the base64 blob (decode + embedded-type check)
 * is deliberately NOT here: it needs Buffer, which this client-shared module
 * must not assume. The server re-validates with `validateSshKeyStrict`.
 */
export function validateSshPublicKey(input: string): SshKeyValidation {
  // 1. private keys: OpenSSH/PEM armor or PuTTY PPK — hard reject FIRST
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(input) || /^PuTTY-User-Key-File-/m.test(input))
    return { ok: false, reason: "private_key" }

  // 2. size cap (a real public key is < 4KB even for rsa-8192)
  if (input.length > 8192) return { ok: false, reason: "too_long" }

  // 3. single line only (two pasted keys, or a wrapped paste)
  const trimmed = input.trim()
  if (trimmed === "") return { ok: false, reason: "bad_shape" }
  if (/[\r\n]/.test(trimmed)) return { ok: false, reason: "multiline" }

  // 4. shape: type SP base64 [SP comment]
  const m = /^(\S+)[ \t]+([A-Za-z0-9+/]+={0,3})(?:[ \t]+(.*))?$/.exec(trimmed)
  if (!m) return { ok: false, reason: "bad_shape" }
  const [, keyType, body, comment] = m

  // 5. allowed types (ssh-dss called out separately: it exists but is weak)
  if (keyType === "ssh-dss") return { ok: false, reason: "weak_algorithm" }
  if (!(SSH_KEY_TYPES as readonly string[]).includes(keyType)) return { ok: false, reason: "unsupported_type" }

  return {
    ok: true,
    keyType,
    body,
    comment: comment?.trim() ? comment.trim() : null,
    normalized: `${keyType} ${body}`,
  }
}

/** Quick predicate for the UI's paste-panic path. */
export const looksLikePrivateKey = (input: string): boolean =>
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(input) || /^PuTTY-User-Key-File-/m.test(input)

export function validateKeyTitle(
  raw: string,
): { ok: true; title: string } | { ok: false; reason: SshKeyValidationReason } {
  // strip control chars, collapse whitespace runs
  const title = raw
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (title === "") return { ok: false, reason: "title_required" }
  if (title.length > MAX_TITLE_LENGTH) return { ok: false, reason: "title_too_long" }
  return { ok: true, title }
}

export type SettingsGitKeysMutation =
  | { intent: "addGitKey"; auth: AuthInfo; title: string; publicKey: string }
  | { intent: "deleteGitKey"; auth: AuthInfo; keyId: number }

export type GitKeysErrorCode = ForgejoFailure | SshKeyValidationReason | "too_many_keys" | "unknown"

export type SettingsGitKeysResult =
  | { gitKeyAdded: true; id: number; title: string; fingerprint: string; alreadyPresent: boolean }
  | { gitKeyDeleted: true; keyId: number }
  | { gitKeyError: GitKeysErrorCode }
