import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { hashToken } from "./crypto.server"

describe("hashToken", () => {
  it.effect("produces a 64-char hex SHA-256 digest", () =>
    Effect.sync(() => {
      const result = hashToken("test-token")
      expect(result).toHaveLength(64)
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    }),
  )

  it.effect("is deterministic", () =>
    Effect.sync(() => {
      const a = hashToken("same-token")
      const b = hashToken("same-token")
      expect(a).toBe(b)
    }),
  )

  it.effect("produces different hashes for different inputs", () =>
    Effect.sync(() => {
      const a = hashToken("token-a")
      const b = hashToken("token-b")
      expect(a).not.toBe(b)
    }),
  )
})
