// @vitest-environment node
// Configure env BEFORE module imports — LldapClientLive reads these via
// Effect.Config at layer-build time. Base URL must match LLDAP_BASE in
// msw-server.ts so the central handlers respond to this client's requests.
process.env.LLDAP_URL = "http://lldap.test:17170"
process.env.LLDAP_ADMIN_USER = "admin"
process.env.LLDAP_ADMIN_PASS = "test-password"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { http, HttpResponse, LLDAP_BASE, server } from "~/test/msw-server"
import { LldapClient, LldapClientLive, toStandardB64, toUrlB64 } from "./LldapClient.server"

vi.setConfig({ testTimeout: 15000 })

const URL = LLDAP_BASE

// Track login calls across tests — overrides the central default with a
// counter so we can assert "auth-once and reuse the token".
let loginCalls = 0
beforeEach(() => {
  loginCalls = 0
  server.use(
    http.post(`${URL}/auth/simple/login`, () => {
      loginCalls++
      return HttpResponse.json({ token: "test-token" })
    }),
  )
})
afterEach(() => {
  // Global resetHandlers in setup.ts wipes the per-test login spy too.
})

// -----------------------------------------------------------------------------
// Per-test runtime: builds LldapClientLive + HttpClient fresh so the token
// cache (Ref) doesn't bleed across tests.
// -----------------------------------------------------------------------------

function makeRuntime() {
  const layer = LldapClientLive.pipe(Layer.provide(FetchHttpClient.layer))
  return ManagedRuntime.make(layer)
}

/** GraphQL handler factory: maps query substrings to fixed responses. */
function graphqlHandler(cases: Array<{ match: string; data: unknown; errors?: Array<{ message: string }> }>) {
  return http.post(`${URL}/api/graphql`, async ({ request }) => {
    const body = (await request.json()) as { query: string; variables?: unknown }
    for (const c of cases) {
      if (body.query.includes(c.match)) {
        return HttpResponse.json({ data: c.data, errors: c.errors })
      }
    }
    return HttpResponse.json(
      { errors: [{ message: `No mock for query: ${body.query.slice(0, 60)}` }] },
      { status: 200 },
    )
  })
}

describe("LldapClient — getUsers", () => {
  it("authenticates once and returns the users array", async () => {
    server.use(
      graphqlHandler([
        {
          match: "users {",
          data: {
            users: [
              { id: "alice", email: "a@x", displayName: "Alice", creationDate: "2026-01-01T00:00:00Z" },
              { id: "bob", email: "b@x", displayName: "Bob", creationDate: "2026-01-02T00:00:00Z" },
            ],
          },
        },
      ]),
    )

    const rt = makeRuntime()
    const users = await rt.runPromise(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        return yield* lldap.getUsers
      }),
    )
    expect(users.map((u) => u.id)).toEqual(["alice", "bob"])
    expect(loginCalls).toBe(1)
    await rt.dispose()
  })

  it("reuses the token across calls (Ref cache) — second getUsers issues no extra login", async () => {
    server.use(graphqlHandler([{ match: "users {", data: { users: [] } }]))

    const rt = makeRuntime()
    await rt.runPromise(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        yield* lldap.getUsers
        yield* lldap.getUsers
        yield* lldap.getUsers
      }),
    )
    expect(loginCalls).toBe(1)
    await rt.dispose()
  })
})

describe("LldapClient — getGroups", () => {
  it("returns the group list", async () => {
    server.use(
      graphqlHandler([
        {
          match: "groups {",
          data: {
            groups: [
              { id: 1, displayName: "family" },
              { id: 2, displayName: "media" },
            ],
          },
        },
      ]),
    )

    const rt = makeRuntime()
    const groups = await rt.runPromise(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        return yield* lldap.getGroups
      }),
    )
    expect(groups.map((g) => g.displayName)).toEqual(["family", "media"])
    await rt.dispose()
  })
})

describe("LldapClient — createUser / addUserToGroup / removeUserFromGroup / deleteUser", () => {
  it("createUser sends a CreateUser mutation and resolves to void", async () => {
    const seen: Array<unknown> = []
    server.use(
      http.post(`${URL}/api/graphql`, async ({ request }) => {
        const body = await request.json()
        seen.push(body)
        return HttpResponse.json({ data: { createUser: { id: "alice" } } })
      }),
    )

    const rt = makeRuntime()
    await rt.runPromise(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        yield* lldap.createUser({
          id: "alice",
          email: "a@x",
          displayName: "Alice",
          firstName: "Alice",
          lastName: "Doe",
        })
      }),
    )

    expect(seen).toHaveLength(1)
    const sent = seen[0] as { query: string; variables: { user: { id: string } } }
    expect(sent.query).toContain("CreateUser")
    expect(sent.variables.user.id).toBe("alice")
    await rt.dispose()
  })

  it("addUserToGroup sends an AddUserToGroup mutation with the right variables", async () => {
    const seen: Array<unknown> = []
    server.use(
      http.post(`${URL}/api/graphql`, async ({ request }) => {
        const body = await request.json()
        seen.push(body)
        return HttpResponse.json({ data: { addUserToGroup: { ok: true } } })
      }),
    )

    const rt = makeRuntime()
    await rt.runPromise(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        yield* lldap.addUserToGroup("alice", 42)
      }),
    )

    const sent = seen[0] as { variables: { userId: string; groupId: number } }
    expect(sent.variables).toEqual({ userId: "alice", groupId: 42 })
    await rt.dispose()
  })

  it("removeUserFromGroup sends a RemoveUserFromGroup mutation", async () => {
    const seen: Array<unknown> = []
    server.use(
      http.post(`${URL}/api/graphql`, async ({ request }) => {
        const body = await request.json()
        seen.push(body)
        return HttpResponse.json({ data: { removeUserFromGroup: { ok: true } } })
      }),
    )

    const rt = makeRuntime()
    await rt.runPromise(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        yield* lldap.removeUserFromGroup("alice", 42)
      }),
    )

    const sent = seen[0] as { query: string; variables: { userId: string; groupId: number } }
    expect(sent.query).toContain("RemoveUserFromGroup")
    expect(sent.variables).toEqual({ userId: "alice", groupId: 42 })
    await rt.dispose()
  })

  it("deleteUser sends a DeleteUser mutation", async () => {
    const seen: Array<unknown> = []
    server.use(
      http.post(`${URL}/api/graphql`, async ({ request }) => {
        const body = await request.json()
        seen.push(body)
        return HttpResponse.json({ data: { deleteUser: { ok: true } } })
      }),
    )

    const rt = makeRuntime()
    await rt.runPromise(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        yield* lldap.deleteUser("alice")
      }),
    )

    const sent = seen[0] as { query: string; variables: { userId: string } }
    expect(sent.query).toContain("DeleteUser")
    expect(sent.variables).toEqual({ userId: "alice" })
    await rt.dispose()
  })
})

describe("LldapClient — createGroup / ensureGroup", () => {
  it("createGroup sends a CreateGroup mutation and returns the new group", async () => {
    server.use(
      graphqlHandler([
        {
          match: "createGroup",
          data: { createGroup: { id: 99, displayName: "ops" } },
        },
      ]),
    )

    const rt = makeRuntime()
    const group = await rt.runPromise(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        return yield* lldap.createGroup("ops")
      }),
    )
    expect(group).toEqual({ id: 99, displayName: "ops" })
    await rt.dispose()
  })

  it("ensureGroup returns the existing id when the group already exists (no create call)", async () => {
    let createCalls = 0
    server.use(
      http.post(`${URL}/api/graphql`, async ({ request }) => {
        const body = (await request.json()) as { query: string }
        if (body.query.includes("groups {")) {
          return HttpResponse.json({
            data: { groups: [{ id: 7, displayName: "existing" }] },
          })
        }
        if (body.query.includes("createGroup")) {
          createCalls++
          return HttpResponse.json({ data: { createGroup: { id: 99, displayName: "existing" } } })
        }
        return HttpResponse.json({ errors: [{ message: "unhandled" }] })
      }),
    )

    const rt = makeRuntime()
    const id = await rt.runPromise(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        return yield* lldap.ensureGroup("existing")
      }),
    )
    expect(id).toBe(7)
    expect(createCalls).toBe(0)
    await rt.dispose()
  })

  it("ensureGroup creates the group when it doesn't exist", async () => {
    let createCalls = 0
    server.use(
      http.post(`${URL}/api/graphql`, async ({ request }) => {
        const body = (await request.json()) as { query: string }
        if (body.query.includes("groups {")) {
          return HttpResponse.json({ data: { groups: [] } })
        }
        if (body.query.includes("createGroup")) {
          createCalls++
          return HttpResponse.json({ data: { createGroup: { id: 99, displayName: "new" } } })
        }
        return HttpResponse.json({ errors: [{ message: "unhandled" }] })
      }),
    )

    const rt = makeRuntime()
    const id = await rt.runPromise(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        return yield* lldap.ensureGroup("new")
      }),
    )
    expect(id).toBe(99)
    expect(createCalls).toBe(1)
    await rt.dispose()
  })
})

describe("LldapClient — error surface", () => {
  it("propagates an LldapError when login fails", async () => {
    server.use(http.post(`${URL}/auth/simple/login`, () => HttpResponse.json({ error: "bad creds" }, { status: 401 })))

    const rt = makeRuntime()
    const result = await rt.runPromiseExit(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        return yield* lldap.getUsers
      }),
    )
    expect(result._tag).toBe("Failure")
    await rt.dispose()
  })

  it("surfaces GraphQL-level errors via LldapError", async () => {
    server.use(graphqlHandler([{ match: "users {", data: null, errors: [{ message: "users-failed" }] }]))

    const rt = makeRuntime()
    const result = await rt.runPromiseExit(
      Effect.gen(function* () {
        const lldap = yield* LldapClient
        return yield* lldap.getUsers
      }),
    )
    expect(result._tag).toBe("Failure")
    await rt.dispose()
  })
})

// -----------------------------------------------------------------------------
// setUserPassword — the OPAQUE registration handshake against LLDAP
// -----------------------------------------------------------------------------

describe("LldapClient — setUserPassword (OPAQUE)", () => {
  it("completes a real handshake against LLDAP's standard-base64 endpoints", async () => {
    const opaque = await import("@serenity-kit/opaque")
    await opaque.ready
    const serverSetup = opaque.server.createSetup()
    const paths: string[] = []
    // A real OPAQUE server: if the client sent the wrong encoding, this cannot
    // decode the request and the handshake throws — no assertion needed beyond
    // "it completed".
    server.use(
      http.post(`${URL}/auth/opaque/register/start`, async ({ request }) => {
        paths.push(new global.URL(request.url).pathname)
        const body = (await request.json()) as { username: string; registration_start_request: string }
        // LLDAP speaks standard base64; base64url would be a different string.
        expect(body.registration_start_request).not.toMatch(/[-_]/)
        const registrationResponse = opaque.server.createRegistrationResponse({
          serverSetup,
          userIdentifier: body.username,
          registrationRequest: toUrlB64(body.registration_start_request),
        }).registrationResponse
        return HttpResponse.json({
          server_data: "srv",
          registration_response: toStandardB64(registrationResponse),
        })
      }),
      http.post(`${URL}/auth/opaque/register/finish`, async ({ request }) => {
        paths.push(new global.URL(request.url).pathname)
        const body = (await request.json()) as { registration_upload: string }
        expect(body.registration_upload).not.toMatch(/[-_]/)
        return HttpResponse.json({})
      }),
    )

    const runtime = makeRuntime()
    await runtime.runPromise(
      Effect.flatMap(LldapClient, (c) => c.setUserPassword("alice", "correct horse battery staple")),
    )

    // The "/base64" suffixes these calls used to carry do not exist on LLDAP.
    expect(paths).toEqual(["/auth/opaque/register/start", "/auth/opaque/register/finish"])
  })

  it("reports the path when LLDAP answers with its admin UI instead of JSON", async () => {
    // LLDAP serves its SPA from a catch-all, so a wrong API path comes back as
    // 200 text/html rather than a 404 — the failure that made a mistyped
    // endpoint look like a crypto error for an entire release.
    server.use(
      http.post(`${URL}/auth/opaque/register/start`, () =>
        HttpResponse.html("<!doctype html><html><title>LLDAP Administration</title></html>"),
      ),
    )

    const runtime = makeRuntime()
    const result = await runtime.runPromise(
      Effect.flip(Effect.flatMap(LldapClient, (c) => c.setUserPassword("alice", "hunter2"))),
    )
    expect(result.message).toContain("/auth/opaque/register/start")
    expect(result.message).toContain("text/html")
  })
})

describe("base64 translation helpers", () => {
  it("round-trips between base64url and standard base64", () => {
    const urlish = "abc-def_ghi"
    expect(toStandardB64(urlish)).toBe("abc+def/ghi=")
    expect(toUrlB64(toStandardB64(urlish))).toBe(urlish)
  })

  it("pads standard base64, which Rust's STANDARD engine requires", () => {
    expect(toStandardB64("YQ")).toBe("YQ==")
    expect(toStandardB64("YWJj")).toBe("YWJj")
  })
})
