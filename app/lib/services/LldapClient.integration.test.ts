// @vitest-environment node
//
// Real OPAQUE handshake against a real LLDAP.
//
// This is the test that would have caught the v1.57.x outage, where account
// creation could not succeed for anyone: LldapClient posted to
// `/auth/opaque/register/start/base64`, a route LLDAP does not have. Because
// LLDAP serves its admin SPA from a catch-all, the wrong path answered
// `200 text/html`; the request passed its status check and only failed when
// parsing JSON, so the error blamed the payload rather than the URL. Every unit
// test passed throughout — they mock the HTTP layer that was itself wrong.
//
// So this suite mocks nothing below the client. It drives the real
// `LldapClientLive` against the same LLDAP image production runs, and proves
// the password it registers actually authenticates — which additionally pins
// the wire encoding (standard base64 vs base64url) and the Argon2 KSF
// parameters, since a mismatch in either registers "successfully" and then
// fails every subsequent login.
//
// Needs an LLDAP on LLDAP_URL (default http://localhost:17170); the
// `integration` CI job starts one under Buildah. Locally:
//
//   podman run --rm -p 17170:17170 \
//     -e LLDAP_JWT_SECRET=ci -e LLDAP_LDAP_USER_PASS=ci-admin-password \
//     -e LLDAP_DATABASE_URL='sqlite:///tmp/lldap.db?mode=rwc' \
//     -e LLDAP_KEY_FILE=/tmp/lldap_key \
//     ghcr.io/fredericrous/lldap:opaque-ke-4 /app/lldap run
//   npm run test:integration
//
// Override the image's entrypoint as above: it requires a /data the image does
// not ship, and then dies on an unbound $GID. The homelab Deployment runs the
// binary directly for the same reason.

import { beforeAll, describe, expect, it } from "vitest"
import { Effect, Layer, ManagedRuntime } from "effect"
import { FetchHttpClient } from "@effect/platform"

import { LldapClient, LldapClientLive } from "./LldapClient.server"

// Provided by vitest.integration.config.ts `test.env`, so they are in place
// before LldapClientLive reads them through Effect.Config.
const LLDAP_URL = process.env.LLDAP_URL!

const runtime = ManagedRuntime.make(LldapClientLive.pipe(Layer.provide(FetchHttpClient.layer)))
const run = <A, E>(effect: Effect.Effect<A, E, LldapClient>) => runtime.runPromise(effect)

/** Exactly what an LDAP bind does with the registered password. */
const loginAs = (username: string, password: string) =>
  fetch(`${LLDAP_URL}/auth/simple/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  })

beforeAll(async () => {
  // The container may still be opening its listener when vitest starts.
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${LLDAP_URL}/health`)
      if (r.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`LLDAP never became healthy at ${LLDAP_URL}`)
})

describe("LldapClient against a real LLDAP", () => {
  it("registers a password that then authenticates", async () => {
    const username = `it-opaque-${Date.now().toString(36)}`
    const password = "correct horse battery staple"

    await run(
      Effect.flatMap(LldapClient, (c) =>
        c.createUser({
          id: username,
          email: `${username}@ci.invalid`,
          displayName: username,
          firstName: username,
          lastName: "",
        }),
      ),
    )

    // The step that was broken in production.
    await run(Effect.flatMap(LldapClient, (c) => c.setUserPassword(username, password)))

    const ok = await loginAs(username, password)
    expect(ok.status).toBe(200)

    // ...and the check has teeth: a wrong password must not pass.
    const bad = await loginAs(username, "not the password")
    expect(bad.status).not.toBe(200)

    await run(Effect.flatMap(LldapClient, (c) => c.deleteUser(username)))
  })

  it("has no /base64 OPAQUE routes — LLDAP answers those with its admin UI", async () => {
    // Pins the trap itself. A wrong API path here is not a 404: it is a 200
    // carrying HTML, which is why the original bug survived a status check.
    // If a future LLDAP ever adds these routes, this test failing is the signal
    // to revisit LldapClient rather than a defect.
    const res = await fetch(`${LLDAP_URL}/auth/opaque/register/start/base64`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/html")

    // The route the client actually uses exists and demands authentication.
    const real = await fetch(`${LLDAP_URL}/auth/opaque/register/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(real.status).toBe(401)
  })
})
