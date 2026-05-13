// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

// config.server is loaded by test/setup.ts before any test file runs, so
// setting process.env.OPERATOR_API_URL inside this file is too late — the
// cached `config.operatorApiUrl` is already "". Mock the module so the
// Live layer sees the test URL the central MSW server defaults to.
vi.mock("~/lib/config.server", () => ({
  config: { operatorApiUrl: "http://operator.test:8080" },
  isOriginAllowed: () => true,
}))

import { Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { http, HttpResponse, OPERATOR_BASE, server } from "~/test/msw-server"
import { OperatorClient, OperatorClientDev, OperatorClientLive } from "./OperatorClient.server"

function makeRuntime() {
  return ManagedRuntime.make(OperatorClientLive.pipe(Layer.provide(FetchHttpClient.layer)))
}

describe("OperatorClient (Live) — listApps", () => {
  it("returns the decoded apps from the operator REST endpoint", async () => {
    server.use(
      http.get(`${OPERATOR_BASE}/api/v1/apps`, () =>
        HttpResponse.json([
          {
            id: "jellyfin",
            name: "Jellyfin",
            url: "https://jellyfin.local",
            category: "media",
            groups: ["media_users"],
            priority: 10,
          },
          {
            id: "vaultwarden",
            name: "Vaultwarden",
            url: "https://vaultwarden.local",
            category: "tools",
            groups: ["admins"],
            priority: 5,
          },
        ]),
      ),
    )

    const rt = makeRuntime()
    const apps = await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* OperatorClient
        return yield* c.listApps()
      }),
    )

    expect(apps.map((a) => a.id)).toEqual(["jellyfin", "vaultwarden"])
    expect(apps[0].priority).toBe(10)
    await rt.dispose()
  })

  it("fails with OperatorClientError when the response shape can't be decoded", async () => {
    server.use(
      http.get(`${OPERATOR_BASE}/api/v1/apps`, () => HttpResponse.json([{ id: "x" /* missing required fields */ }])),
    )

    const rt = makeRuntime()
    const result = await rt.runPromiseExit(
      Effect.gen(function* () {
        const c = yield* OperatorClient
        return yield* c.listApps()
      }),
    )
    expect(result._tag).toBe("Failure")
    await rt.dispose()
  })

  it("fails with OperatorClientError when the HTTP call errors", async () => {
    server.use(http.get(`${OPERATOR_BASE}/api/v1/apps`, () => HttpResponse.json({ error: "boom" }, { status: 500 })))

    const rt = makeRuntime()
    const result = await rt.runPromiseExit(
      Effect.gen(function* () {
        const c = yield* OperatorClient
        return yield* c.listApps()
      }),
    )
    expect(result._tag).toBe("Failure")
    await rt.dispose()
  })
})

describe("OperatorClient (Dev) — listApps", () => {
  it("returns the fixture apps without hitting the network", async () => {
    const rt = ManagedRuntime.make(OperatorClientDev)
    const apps = await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* OperatorClient
        return yield* c.listApps()
      }),
    )
    expect(apps.map((a) => a.id)).toEqual(["jellyfin", "navidrome", "vaultwarden"])
    await rt.dispose()
  })
})
