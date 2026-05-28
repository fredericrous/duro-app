// @vitest-environment node
import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { ApiKeyRepo, ApiKeyRepoLive } from "./ApiKeyRepo.server"

const TestLayer = ApiKeyRepoLive.pipe(Layer.provideMerge(makeTestDbLayer()))

const seedPrincipal = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-ak', 'user', 'ak', 'API Key User', 'ak@example.com')`
  return "p-ak"
})

describe("ApiKeyRepo", () => {
  it.layer(TestLayer)("create returns an id and a raw token with the duro_ prefix", (it) => {
    it.effect("happy path", () =>
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo
        const principalId = yield* seedPrincipal

        const { id, rawKey, keyPreview } = yield* repo.create({
          principalId,
          name: "ci-token",
          scopes: ["read"],
        })

        expect(id).toMatch(/^[0-9a-f-]{36}$/i)
        expect(rawKey).toMatch(/^duro_[0-9a-f]{64}$/)
        expect(keyPreview).toMatch(/^duro_[0-9a-f]{4}…[0-9a-f]{4}$/)
      }),
    )
  })

  it.layer(TestLayer)("verify returns principalId+scopes for a valid raw token", (it) => {
    // Regression: before the fix, `verify` called `JSON.parse(row.scopes as string)`
    // on an already-parsed JSONB array, double-decoding it and throwing. The
    // bug masked itself in dev because verify is reached only via API-key
    // auth, and no test covered it.
    it.effect("create → verify round-trip preserves the full scope array", () =>
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo
        const principalId = yield* seedPrincipal

        const { rawKey } = yield* repo.create({
          principalId,
          name: "ci-token",
          scopes: ["read", "write", "admin"],
        })
        const verified = yield* repo.verify(rawKey)

        expect(verified?.principalId).toBe(principalId)
        expect(verified?.scopes).toEqual(["read", "write", "admin"])
      }),
    )
  })

  it.layer(TestLayer)("verify returns null for an unknown token", (it) => {
    it.effect("unknown token", () =>
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo
        const result = yield* repo.verify("duro_unknown")
        expect(result).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("verify returns null after revoke", (it) => {
    it.effect("revoked token rejected (revoked_at filter trims the row)", () =>
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo
        const principalId = yield* seedPrincipal

        const { id, rawKey } = yield* repo.create({
          principalId,
          name: "ci-token",
          scopes: ["read"],
        })
        yield* repo.revoke(id)

        const verified = yield* repo.verify(rawKey)
        expect(verified).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("listForPrincipal returns the keys for that principal", (it) => {
    it.effect("filters by principalId", () =>
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo
        const principalId = yield* seedPrincipal
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
                   VALUES ('p-other', 'user', 'other', 'Other', 'other@example.com')`

        yield* repo.create({ principalId, name: "key-a", scopes: ["read"] })
        yield* repo.create({ principalId, name: "key-b", scopes: ["write"] })
        yield* repo.create({ principalId: "p-other", name: "key-c", scopes: ["admin"] })

        const mine = yield* repo.listForPrincipal(principalId)
        expect(mine).toHaveLength(2)
        expect(mine.map((k) => k.name).sort()).toEqual(["key-a", "key-b"])

        const empty = yield* repo.listForPrincipal("no-such-user")
        expect(empty).toEqual([])
      }),
    )
  })

  it.layer(TestLayer)("revoke on a missing id silently succeeds", (it) => {
    it.effect("no-op revoke", () =>
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo
        yield* repo.revoke("non-existent-id")
        expect(true).toBe(true)
      }),
    )
  })

  it.layer(TestLayer)("expiresInDays bounds the verify window", (it) => {
    it.effect("a -1 day key (already expired) verifies as null", () =>
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo
        const principalId = yield* seedPrincipal

        // expiresInDays>0 in the public API; for the test we backdate by
        // hand to simulate a key that just crossed its TTL.
        const { rawKey } = yield* repo.create({
          principalId,
          name: "soon-expired",
          scopes: ["read"],
          expiresInDays: 1,
        })
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE api_keys SET expires_at = NOW() - interval '1 day' WHERE name = 'soon-expired'`

        const verified = yield* repo.verify(rawKey)
        expect(verified).toBeNull()
      }),
    )
  })

  it.layer(TestLayer)("create persists a non-empty key_preview row", (it) => {
    it.effect("listForPrincipal returns the preview", () =>
      Effect.gen(function* () {
        const repo = yield* ApiKeyRepo
        const principalId = yield* seedPrincipal
        const { keyPreview } = yield* repo.create({
          principalId,
          name: "with-preview",
          scopes: ["read"],
        })
        const keys = yield* repo.listForPrincipal(principalId)
        expect(keys[0].keyPreview).toBe(keyPreview)
      }),
    )
  })
})
