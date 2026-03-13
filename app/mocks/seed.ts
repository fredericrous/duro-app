import { execSync } from "node:child_process"
import * as crypto from "node:crypto"

/** Well-known dev token — visit /invite/dev-test-token */
export const DEV_INVITE_TOKEN = "dev-test-token"

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}

export function seedDevDatabase(dbPath: string) {
  const tokenHash = hashToken(DEV_INVITE_TOKEN)

  // Check if dev invite already exists
  const existing = execSync(
    `sqlite3 "${dbPath}" "SELECT id FROM invites WHERE token_hash = '${tokenHash}'" 2>/dev/null`,
    { encoding: "utf-8" },
  ).trim()

  if (existing) return

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() // 1 year

  const sql = `INSERT INTO invites (
    id, token, token_hash, email, groups, group_names,
    invited_by, created_at, expires_at, attempts,
    cert_issued, pr_created, pr_merged, email_sent,
    reconcile_attempts, revert_pr_merged, cert_verified, locale
  ) VALUES (
    '${id}', '${DEV_INVITE_TOKEN}', '${tokenHash}', 'dev@example.com',
    '[1,2]', '["family","media"]', 'admin', '${now}', '${expires}', 0,
    0, 0, 0, 1, 0, 0, 0, 'en'
  );`

  execSync(`sqlite3 "${dbPath}" "${sql}"`)
  console.log(`[dev] Seeded invite: /invite/${DEV_INVITE_TOKEN}`)
}
