// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

// config.server is loaded by test/setup.ts before any test file runs, so
// setting process.env here would be too late for the cached config object.
// Mock the module (the OperatorClient test's trick).
vi.mock("~/lib/config.server", () => ({
  config: { forgejoUrl: "http://forgejo.test:3000", forgejoPublicUrl: "https://forgejo.test" },
  isOriginAllowed: () => true,
}))
process.env.FORGEJO_ADMIN_TOKEN = "test-admin-token"

import { Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { http, HttpResponse, FORGEJO_BASE, server } from "~/test/msw-server"
import { ForgejoClient, ForgejoClientError, ForgejoClientLive } from "./ForgejoClient.server"

function makeRuntime() {
  return ManagedRuntime.make(ForgejoClientLive.pipe(Layer.provide(FetchHttpClient.layer)))
}

const failKind = <R>(eff: Effect.Effect<unknown, ForgejoClientError, R>) =>
  eff.pipe(
    Effect.map(() => "succeeded" as const),
    Effect.catchAll((e) => Effect.succeed(e.kind)),
  )

describe("ForgejoClient (Live) — userExists", () => {
  it("true on 200, false on 404", async () => {
    const rt = makeRuntime()
    server.use(http.get(`${FORGEJO_BASE}/api/v1/users/alice`, () => HttpResponse.json({ id: 2, login: "alice" })))
    await expect(rt.runPromise(Effect.flatMap(ForgejoClient, (c) => c.userExists("alice")))).resolves.toBe(true)
    await expect(rt.runPromise(Effect.flatMap(ForgejoClient, (c) => c.userExists("nobody")))).resolves.toBe(false)
    await rt.dispose()
  })

  it("403 maps to unauthorized — the admin-token signal", async () => {
    const rt = makeRuntime()
    server.use(
      http.get(`${FORGEJO_BASE}/api/v1/users/alice`, () =>
        HttpResponse.json({ message: "forbidden" }, { status: 403 }),
      ),
    )
    await expect(rt.runPromise(failKind(Effect.flatMap(ForgejoClient, (c) => c.userExists("alice"))))).resolves.toBe(
      "unauthorized",
    )
    await rt.dispose()
  })
})

describe("ForgejoClient (Live) — listKeys", () => {
  it("decodes and camelCases the wire shape", async () => {
    const rt = makeRuntime()
    server.use(
      http.get(`${FORGEJO_BASE}/api/v1/users/alice/keys`, () =>
        HttpResponse.json([
          {
            id: 7,
            title: "Laptop",
            fingerprint: "SHA256:abc",
            created_at: "2026-08-01T00:00:00Z",
            key_type: "ssh-ed25519",
            key: "ssh-ed25519 AAAA... never-exposed",
          },
        ]),
      ),
    )
    const keys = await rt.runPromise(Effect.flatMap(ForgejoClient, (c) => c.listKeys("alice")))
    expect(keys).toEqual([
      { id: 7, title: "Laptop", fingerprint: "SHA256:abc", createdAt: "2026-08-01T00:00:00Z", keyType: "ssh-ed25519" },
    ])
    // the raw key body must not survive the mapping
    expect(JSON.stringify(keys)).not.toContain("AAAA")
    await rt.dispose()
  })

  it("malformed payload → unavailable", async () => {
    const rt = makeRuntime()
    server.use(http.get(`${FORGEJO_BASE}/api/v1/users/alice/keys`, () => HttpResponse.json([{ nope: true }])))
    await expect(rt.runPromise(failKind(Effect.flatMap(ForgejoClient, (c) => c.listKeys("alice"))))).resolves.toBe(
      "unavailable",
    )
    await rt.dispose()
  })
})

describe("ForgejoClient (Live) — addKey", () => {
  it("POSTs with ?sudo=<user> and the title/key body", async () => {
    const rt = makeRuntime()
    let seenUrl = ""
    let seenBody: unknown = null
    server.use(
      http.post(`${FORGEJO_BASE}/api/v1/user/keys`, async ({ request }) => {
        seenUrl = request.url
        seenBody = await request.json()
        return HttpResponse.json(
          { id: 42, title: "Laptop", fingerprint: "SHA256:xyz", created_at: "2026-08-16T00:00:00Z" },
          { status: 201 },
        )
      }),
    )
    const key = await rt.runPromise(
      Effect.flatMap(ForgejoClient, (c) => c.addKey("alice", { title: "Laptop", key: "ssh-ed25519 AAAAC3Nz" })),
    )
    expect(seenUrl).toContain("sudo=alice")
    expect(seenBody).toEqual({ title: "Laptop", key: "ssh-ed25519 AAAAC3Nz" })
    expect(key.id).toBe(42)
    expect(key.keyType).toBeNull()
    await rt.dispose()
  })

  it("422 'has been used' → key_in_use; 422 naming the title → title_taken; other 422 → invalid_key", async () => {
    const rt = makeRuntime()
    const with422 = (message: string) =>
      server.use(http.post(`${FORGEJO_BASE}/api/v1/user/keys`, () => HttpResponse.json({ message }, { status: 422 })))
    const add = failKind(Effect.flatMap(ForgejoClient, (c) => c.addKey("alice", { title: "L", key: "ssh-ed25519 A" })))
    with422("Key content has been used as non-deploy key")
    await expect(rt.runPromise(add)).resolves.toBe("key_in_use")
    with422("Key title has been used")
    await expect(rt.runPromise(add)).resolves.toBe("title_taken")
    with422("Invalid key format")
    await expect(rt.runPromise(add)).resolves.toBe("invalid_key")
    await rt.dispose()
  })
})

describe("ForgejoClient (Live) — deleteKey", () => {
  it("resolves on Forgejo's empty 204 (makeJsonApi cannot — regression guard)", async () => {
    const rt = makeRuntime()
    await expect(rt.runPromise(Effect.flatMap(ForgejoClient, (c) => c.deleteKey("alice", 7)))).resolves.toBeUndefined()
    await rt.dispose()
  })

  it("404 → key_not_found", async () => {
    const rt = makeRuntime()
    server.use(
      http.delete(`${FORGEJO_BASE}/api/v1/user/keys/:id`, () =>
        HttpResponse.json({ message: "not found" }, { status: 404 }),
      ),
    )
    await expect(rt.runPromise(failKind(Effect.flatMap(ForgejoClient, (c) => c.deleteKey("alice", 7))))).resolves.toBe(
      "key_not_found",
    )
    await rt.dispose()
  })
})

describe("ForgejoClient (Live) — guards", () => {
  it("a path-traversal username never reaches the wire", async () => {
    const rt = makeRuntime()
    let hit = false
    server.use(
      http.get(`${FORGEJO_BASE}/api/v1/users/*`, () => {
        hit = true
        return HttpResponse.json({})
      }),
    )
    await expect(rt.runPromise(failKind(Effect.flatMap(ForgejoClient, (c) => c.userExists("../admin"))))).resolves.toBe(
      "account_missing",
    )
    expect(hit).toBe(false)
    await rt.dispose()
  })
})

describe("ForgejoClient (Live) — unconfigured", () => {
  it("empty token → unconfigured, with zero HTTP calls", async () => {
    const saved = process.env.FORGEJO_ADMIN_TOKEN
    delete process.env.FORGEJO_ADMIN_TOKEN
    try {
      const rt = makeRuntime() // layer builds lazily → reads the now-empty env
      let hit = false
      server.use(
        http.get(`${FORGEJO_BASE}/api/v1/users/:username`, () => {
          hit = true
          return HttpResponse.json({})
        }),
      )
      await expect(rt.runPromise(failKind(Effect.flatMap(ForgejoClient, (c) => c.userExists("alice"))))).resolves.toBe(
        "unconfigured",
      )
      expect(hit).toBe(false)
      await rt.dispose()
    } finally {
      process.env.FORGEJO_ADMIN_TOKEN = saved
    }
  })
})
