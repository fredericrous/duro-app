import { Context, Effect, Data, Layer, Config, Redacted } from "effect"
import * as client from "openid-client"

export interface OidcUser {
  sub: string
  name: string
  email: string
  groups: string[]
}

export class OidcError extends Data.TaggedError("OidcError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class OidcClient extends Context.Tag("OidcClient")<
  OidcClient,
  {
    readonly buildAuthRequest: () => Effect.Effect<
      { authorizationUrl: URL; codeVerifier: string; state: string },
      OidcError
    >
    readonly exchangeCode: (
      callbackUrl: URL,
      codeVerifier: string,
      expectedState: string,
    ) => Effect.Effect<OidcUser, OidcError>
    readonly getEndSessionUrl: () => Effect.Effect<string, OidcError>
  }
>() {}

export const OidcClientDev = Layer.succeed(OidcClient, {
  buildAuthRequest: () =>
    Effect.succeed({
      authorizationUrl: new URL("http://localhost/auth/dev"),
      codeVerifier: "dev-verifier",
      state: "dev-state",
    }),
  exchangeCode: () =>
    Effect.succeed({
      sub: "dev",
      name: "dev",
      email: "dev@localhost",
      groups: ["family", "media", "lldap_admin"],
    }),
  getEndSessionUrl: () => Effect.succeed("/"),
})

/**
 * Read a required OIDC config value via the ambient ConfigProvider (env),
 * mapping a missing value to OidcError. Read lazily at first use — same timing
 * as the old process.env reads — so the layer still builds without OIDC env
 * (the failure surfaces at login, where these are always set in production),
 * and the client secret goes through Config.redacted so it never lands in logs.
 */
export const requireConfig = (name: string) =>
  Config.string(name).pipe(Effect.mapError((e) => new OidcError({ message: `Missing OIDC config ${name}`, cause: e })))

export const requireSecret = (name: string) =>
  Config.redacted(name).pipe(
    Effect.mapError((e) => new OidcError({ message: `Missing OIDC config ${name}`, cause: e })),
  )

export const OidcClientLive = Layer.effect(
  OidcClient,
  Effect.sync(() => {
    let oidcConfig: client.Configuration | null = null

    const getConfig = (): Effect.Effect<client.Configuration, OidcError> =>
      oidcConfig
        ? Effect.succeed(oidcConfig)
        : Effect.gen(function* () {
            const issuerUrl = yield* requireConfig("OIDC_ISSUER_URL")
            const clientId = yield* requireConfig("OIDC_CLIENT_ID")
            const clientSecret = yield* requireSecret("OIDC_CLIENT_SECRET")
            const discovered = yield* Effect.tryPromise({
              try: () => client.discovery(new URL(issuerUrl), clientId, Redacted.value(clientSecret)),
              catch: (e) => new OidcError({ message: "OIDC discovery failed", cause: e }),
            })
            oidcConfig = discovered
            return discovered
          })

    return {
      buildAuthRequest: () =>
        Effect.gen(function* () {
          const config = yield* getConfig()
          const redirectUri = yield* requireConfig("OIDC_REDIRECT_URI")
          const codeVerifier = client.randomPKCECodeVerifier()
          const codeChallenge = yield* Effect.tryPromise({
            try: () => client.calculatePKCECodeChallenge(codeVerifier),
            catch: (e) => new OidcError({ message: "PKCE challenge calculation failed", cause: e }),
          })
          const state = client.randomState()

          const authorizationUrl = client.buildAuthorizationUrl(config, {
            redirect_uri: redirectUri,
            scope: "openid profile email groups",
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            state,
          })

          return { authorizationUrl, codeVerifier, state }
        }),

      exchangeCode: (callbackUrl: URL, codeVerifier: string, expectedState: string) =>
        Effect.gen(function* () {
          const config = yield* getConfig()

          const tokens = yield* Effect.tryPromise({
            try: () =>
              client.authorizationCodeGrant(config, callbackUrl, {
                pkceCodeVerifier: codeVerifier,
                expectedState,
                idTokenExpected: true,
              }),
            catch: (e) => new OidcError({ message: "Authorization code exchange failed", cause: e }),
          })

          const claims = tokens.claims()!

          return {
            sub: claims.sub,
            name: (claims.preferred_username ?? claims.name ?? claims.sub) as string,
            email: (claims.email ?? "") as string,
            groups: (claims.groups ?? []) as string[],
          }
        }),

      getEndSessionUrl: () =>
        Effect.gen(function* () {
          const config = yield* getConfig()
          const metadata = config.serverMetadata()
          if (metadata.end_session_endpoint) return metadata.end_session_endpoint
          return yield* requireConfig("OIDC_ISSUER_URL")
        }),
    }
  }),
)
