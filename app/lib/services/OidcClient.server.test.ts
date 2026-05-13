// @vitest-environment node
import { describe, expect, it } from "vitest"
import { Effect, ManagedRuntime } from "effect"
import { OidcClient, OidcClientDev } from "./OidcClient.server"

// The Live variant pulls `openid-client` + hits a real OIDC discovery URL,
// which is integration territory. The Dev variant covers the surface used
// by every test that touches /admin or /home as a logged-in user.

describe("OidcClient (Dev) — auth flow", () => {
  const rt = ManagedRuntime.make(OidcClientDev)

  it("buildAuthRequest returns a deterministic fixture", async () => {
    const result = await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* OidcClient
        return yield* c.buildAuthRequest()
      }),
    )
    expect(result.authorizationUrl).toBeInstanceOf(URL)
    expect(result.codeVerifier).toBe("dev-verifier")
    expect(result.state).toBe("dev-state")
  })

  it("exchangeCode resolves to the dev user with admin group memberships", async () => {
    const user = await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* OidcClient
        return yield* c.exchangeCode(new URL("http://localhost/cb"), "v", "s")
      }),
    )
    expect(user.sub).toBe("dev")
    expect(user.email).toBe("dev@localhost")
    expect(user.groups).toEqual(["family", "media", "lldap_admin"])
  })

  it("getEndSessionUrl returns '/' (no real IdP in dev)", async () => {
    const url = await rt.runPromise(
      Effect.gen(function* () {
        const c = yield* OidcClient
        return yield* c.getEndSessionUrl()
      }),
    )
    expect(url).toBe("/")
  })
})
