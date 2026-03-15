import { Context, Effect, Data, Layer } from "effect"
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

export const OidcClientLive = Layer.effect(
  OidcClient,
  Effect.sync(() => {
    let oidcConfig: client.Configuration | null = null

    const getConfig = (): Effect.Effect<client.Configuration, OidcError> =>
      oidcConfig
        ? Effect.succeed(oidcConfig)
        : Effect.tryPromise({
            try: async () => {
              oidcConfig = await client.discovery(
                new URL(process.env.OIDC_ISSUER_URL!),
                process.env.OIDC_CLIENT_ID!,
                process.env.OIDC_CLIENT_SECRET!,
              )
              return oidcConfig
            },
            catch: (e) => new OidcError({ message: "OIDC discovery failed", cause: e }),
          })

    return {
      buildAuthRequest: () =>
        Effect.gen(function* () {
          const config = yield* getConfig()
          const codeVerifier = client.randomPKCECodeVerifier()
          const codeChallenge = yield* Effect.tryPromise({
            try: () => client.calculatePKCECodeChallenge(codeVerifier),
            catch: (e) => new OidcError({ message: "PKCE challenge calculation failed", cause: e }),
          })
          const state = client.randomState()

          const authorizationUrl = client.buildAuthorizationUrl(config, {
            redirect_uri: process.env.OIDC_REDIRECT_URI!,
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
          return metadata.end_session_endpoint ?? process.env.OIDC_ISSUER_URL!
        }),
    }
  }),
)
