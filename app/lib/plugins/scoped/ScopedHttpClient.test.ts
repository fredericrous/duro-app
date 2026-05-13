// @vitest-environment node
import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { http, HttpResponse, server } from "~/test/msw-server"
import { makeScopedHttpClient } from "./ScopedHttpClient"
import type { PluginManifest, ScopedVaultClient } from "../contracts"

const manifest: PluginManifest = {
  slug: "test-plugin",
  version: "1.0.0",
  displayName: "Test Plugin",
  allowedDomains: ["api.example.com"],
  vaultPaths: ["secret/data/plugins/test/*"],
  timeoutMs: 5000,
  description: "",
  provision: {} as never,
  deprovision: {} as never,
} as unknown as PluginManifest

/** Stub vault — readSecret returns a fixed token. */
const stubVault: ScopedVaultClient = {
  readSecret: (name: string) =>
    name === "secret/missing" ? Effect.fail(new Error("not found") as never) : Effect.succeed("token-abc-123"),
} as unknown as ScopedVaultClient

// MSW is bootstrapped globally in app/test/setup.ts; tests below register
// per-case handlers via `server.use(...)`, which is automatically reset
// in the global afterEach.

describe("makeScopedHttpClient — URL allow-list", () => {
  it("rejects URLs whose host isn't in allowedDomains (ScopeViolation)", async () => {
    const client = makeScopedHttpClient(manifest, stubVault)
    const result = await Effect.runPromiseExit(client.get("https://evil.example.com/foo"))
    expect(result._tag).toBe("Failure")
  })

  it("rejects malformed URLs (ScopeViolation)", async () => {
    const client = makeScopedHttpClient(manifest, stubVault)
    const result = await Effect.runPromiseExit(client.get("not-a-url"))
    expect(result._tag).toBe("Failure")
  })

  it("rejects HTTP (non-HTTPS) URLs in production (ScopeViolation)", async () => {
    const originalEnv = process.env.NODE_ENV
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = "production"
    const client = makeScopedHttpClient(manifest, stubVault)
    const result = await Effect.runPromiseExit(client.get("http://api.example.com/foo"))
    expect(result._tag).toBe("Failure")
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = originalEnv
  })

  it("allows HTTP URLs in development", async () => {
    const originalEnv = process.env.NODE_ENV
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = "development"
    server.use(http.get("http://api.example.com/ok", () => HttpResponse.json({ ok: true })))

    const client = makeScopedHttpClient(manifest, stubVault)
    const result = await Effect.runPromise(client.get("http://api.example.com/ok"))
    expect(result).toEqual({ ok: true })
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = originalEnv
  })
})

describe("makeScopedHttpClient — methods", () => {
  it("GET sends a GET request and parses JSON when content-type is application/json", async () => {
    let method = ""
    server.use(
      http.get("https://api.example.com/users", ({ request }) => {
        method = request.method
        return HttpResponse.json({ users: ["alice"] })
      }),
    )

    const client = makeScopedHttpClient(manifest, stubVault)
    const result = await Effect.runPromise(client.get("https://api.example.com/users"))
    expect(method).toBe("GET")
    expect(result).toEqual({ users: ["alice"] })
  })

  it("POST sends a JSON body and parses the JSON response", async () => {
    let receivedBody: unknown = null
    server.use(
      http.post("https://api.example.com/users", async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ id: "u-1" })
      }),
    )

    const client = makeScopedHttpClient(manifest, stubVault)
    const result = await Effect.runPromise(client.post("https://api.example.com/users", { name: "alice" }))
    expect(receivedBody).toEqual({ name: "alice" })
    expect(result).toEqual({ id: "u-1" })
  })

  it("PUT sends a JSON body", async () => {
    let receivedBody: unknown = null
    server.use(
      http.put("https://api.example.com/users/u-1", async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )

    const client = makeScopedHttpClient(manifest, stubVault)
    await Effect.runPromise(client.put("https://api.example.com/users/u-1", { name: "Alice" }))
    expect(receivedBody).toEqual({ name: "Alice" })
  })

  it("DELETE returns void on success", async () => {
    server.use(http.delete("https://api.example.com/users/u-1", () => HttpResponse.json({ deleted: true })))

    const client = makeScopedHttpClient(manifest, stubVault)
    const result = await Effect.runPromise(client.del("https://api.example.com/users/u-1"))
    expect(result).toBeUndefined()
  })
})

describe("makeScopedHttpClient — secret injection", () => {
  it("injects bearer-style Authorization header when `secret` is provided", async () => {
    let authHeader = ""
    server.use(
      http.get("https://api.example.com/private", ({ request }) => {
        authHeader = request.headers.get("authorization") ?? ""
        return HttpResponse.json({ ok: true })
      }),
    )

    const client = makeScopedHttpClient(manifest, stubVault)
    await Effect.runPromise(
      client.get("https://api.example.com/private", {
        secret: "secret/data/plugins/test/token",
        authHeader: "Bearer",
      }),
    )
    expect(authHeader).toBe("Bearer token-abc-123")
  })

  it("default scheme is 'token' when no authHeader is supplied", async () => {
    let authHeader = ""
    server.use(
      http.get("https://api.example.com/private", ({ request }) => {
        authHeader = request.headers.get("authorization") ?? ""
        return HttpResponse.json({ ok: true })
      }),
    )

    const client = makeScopedHttpClient(manifest, stubVault)
    await Effect.runPromise(client.get("https://api.example.com/private", { secret: "secret/data/plugins/test/token" }))
    expect(authHeader).toBe("token token-abc-123")
  })

  it("sets a custom header name when authHeader is not bearer/token", async () => {
    let xApiKey = ""
    server.use(
      http.get("https://api.example.com/private", ({ request }) => {
        xApiKey = request.headers.get("x-api-key") ?? ""
        return HttpResponse.json({ ok: true })
      }),
    )

    const client = makeScopedHttpClient(manifest, stubVault)
    await Effect.runPromise(
      client.get("https://api.example.com/private", {
        secret: "secret/data/plugins/test/token",
        authHeader: "X-API-Key",
      }),
    )
    expect(xApiKey).toBe("token-abc-123")
  })

  it("propagates a PluginError when the vault secret can't be resolved", async () => {
    const client = makeScopedHttpClient(manifest, stubVault)
    const result = await Effect.runPromiseExit(
      client.get("https://api.example.com/private", { secret: "secret/missing" }),
    )
    expect(result._tag).toBe("Failure")
  })
})

describe("makeScopedHttpClient — response handling", () => {
  it("fails with PluginError on non-2xx responses", async () => {
    server.use(http.get("https://api.example.com/forbidden", () => HttpResponse.json({}, { status: 403 })))

    const client = makeScopedHttpClient(manifest, stubVault)
    const result = await Effect.runPromiseExit(client.get("https://api.example.com/forbidden"))
    expect(result._tag).toBe("Failure")
  })

  it("returns undefined for non-JSON responses (no parse)", async () => {
    server.use(
      http.get("https://api.example.com/raw", () =>
        HttpResponse.text("plain text", { headers: { "content-type": "text/plain" } }),
      ),
    )

    const client = makeScopedHttpClient(manifest, stubVault)
    const result = await Effect.runPromise(client.get("https://api.example.com/raw"))
    expect(result).toBeUndefined()
  })

  it("merges caller-provided headers (auth wins on conflict)", async () => {
    let xCustom = ""
    let auth = ""
    server.use(
      http.get("https://api.example.com/h", ({ request }) => {
        xCustom = request.headers.get("x-custom") ?? ""
        auth = request.headers.get("authorization") ?? ""
        return HttpResponse.json({})
      }),
    )

    const client = makeScopedHttpClient(manifest, stubVault)
    await Effect.runPromise(
      client.get("https://api.example.com/h", {
        secret: "secret/data/plugins/test/token",
        authHeader: "Bearer",
        headers: { "X-Custom": "yes", Authorization: "loser" },
      }),
    )
    expect(xCustom).toBe("yes")
    // Authorization from `secret` (Bearer) overrides the caller-provided one.
    expect(auth).toBe("Bearer token-abc-123")
  })
})
