// @vitest-environment node
import { describe, expect, it } from "vitest"
import { Effect, ManagedRuntime, ConfigProvider, Redacted } from "effect"
import { OidcClient, OidcClientDev, requireConfig, requireSecret } from "./OidcClient.server"

describe("OidcClient config helpers", () => {
  const withEnv = (map: Record<string, string>) => ConfigProvider.fromMap(new Map(Object.entries(map)))

  it("requireConfig reads a present value", async () => {
    const v = await Effect.runPromise(
      requireConfig("OIDC_ISSUER_URL").pipe(Effect.withConfigProvider(withEnv({ OIDC_ISSUER_URL: "https://idp" }))),
    )
    expect(v).toBe("https://idp")
  })

  it("requireConfig maps a missing value to OidcError", async () => {
    const exit = await Effect.runPromiseExit(
      requireConfig("OIDC_ISSUER_URL").pipe(Effect.withConfigProvider(withEnv({}))),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("requireSecret reads a present secret (redacted)", async () => {
    const secret = await Effect.runPromise(
      requireSecret("OIDC_CLIENT_SECRET").pipe(Effect.withConfigProvider(withEnv({ OIDC_CLIENT_SECRET: "shh" }))),
    )
    expect(Redacted.value(secret)).toBe("shh")
  })

  it("requireSecret maps a missing secret to OidcError", async () => {
    const exit = await Effect.runPromiseExit(
      requireSecret("OIDC_CLIENT_SECRET").pipe(Effect.withConfigProvider(withEnv({}))),
    )
    expect(exit._tag).toBe("Failure")
  })
})

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
