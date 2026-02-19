import * as client from "openid-client"

let oidcConfig: client.Configuration | null = null

async function getConfig(): Promise<client.Configuration> {
  if (oidcConfig) return oidcConfig

  oidcConfig = await client.discovery(
    new URL(process.env.OIDC_ISSUER_URL!),
    process.env.OIDC_CLIENT_ID!,
    process.env.OIDC_CLIENT_SECRET!,
  )

  return oidcConfig
}

export async function buildAuthRequest() {
  const config = await getConfig()
  const codeVerifier = client.randomPKCECodeVerifier()
  const codeChallenge =
    await client.calculatePKCECodeChallenge(codeVerifier)
  const state = client.randomState()

  const authorizationUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: process.env.OIDC_REDIRECT_URI!,
    scope: "openid profile email groups",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  })

  return { authorizationUrl, codeVerifier, state }
}

export interface OidcUser {
  sub: string
  name: string
  email: string
  groups: string[]
}

export async function exchangeCode(
  callbackUrl: URL,
  codeVerifier: string,
  expectedState: string,
): Promise<OidcUser> {
  const config = await getConfig()

  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState,
    idTokenExpected: true,
  })

  const claims = tokens.claims()!

  return {
    sub: claims.sub,
    name: (claims.preferred_username ?? claims.name ?? claims.sub) as string,
    email: (claims.email ?? "") as string,
    groups: (claims.groups ?? []) as string[],
  }
}

export async function getEndSessionUrl(): Promise<string> {
  const config = await getConfig()
  const metadata = config.serverMetadata()
  return metadata.end_session_endpoint ?? process.env.OIDC_ISSUER_URL!
}
