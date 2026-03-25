export type AuthMode = "legacy" | "shadow" | "dual" | "governance"

const raw = process.env.AUTH_MODE ?? "legacy"
const valid: AuthMode[] = ["legacy", "shadow", "dual", "governance"]

export const authMode: AuthMode = valid.includes(raw as AuthMode) ? (raw as AuthMode) : "legacy"
