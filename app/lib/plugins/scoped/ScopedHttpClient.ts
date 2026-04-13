import { Effect } from "effect"
import type { ScopedHttpClient, ScopedVaultClient, PluginManifest } from "../contracts"
import { PluginError, ScopeViolation } from "../errors"

/**
 * Build a scoped HTTP client that enforces:
 *  - allowedDomains: only declared hosts can be contacted
 *  - HTTPS-only (except in NODE_ENV=development)
 *  - Per-request timeout from the manifest
 *
 * Secret injection (Vault-backed bearer tokens) is handled via the
 * `secret` option, looked up through ScopedVaultClient by the caller
 * (the interpreter or the imperative plugin code). This scoped client
 * does NOT inject secrets itself — it just validates the URL.
 *
 * Phase 2A scaffolding only — the lldap-group-membership plugin doesn't
 * use HTTP. First real usage in 2B (gitea-teams).
 */
export function makeScopedHttpClient(manifest: PluginManifest, vault: ScopedVaultClient): ScopedHttpClient {
  const isDev = process.env.NODE_ENV === "development"

  const assertUrlAllowed = (rawUrl: string) => {
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return new ScopeViolation({
        pluginSlug: manifest.slug,
        service: "ScopedHttpClient",
        target: rawUrl,
        message: `Invalid URL: ${rawUrl}`,
      })
    }
    if (!isDev && parsed.protocol !== "https:") {
      return new ScopeViolation({
        pluginSlug: manifest.slug,
        service: "ScopedHttpClient",
        target: rawUrl,
        message: `HTTP not allowed in production (use HTTPS)`,
      })
    }
    if (!manifest.allowedDomains.includes(parsed.host)) {
      return new ScopeViolation({
        pluginSlug: manifest.slug,
        service: "ScopedHttpClient",
        target: rawUrl,
        message: `Domain '${parsed.host}' not in plugin's allowedDomains: [${manifest.allowedDomains.join(", ")}]`,
      })
    }
    return null
  }

  const doFetch = (
    url: string,
    init: RequestInit,
    secretName?: string,
    authHeader?: string,
    extraHeaders?: Readonly<Record<string, string>>,
  ) =>
    Effect.gen(function* () {
      const violation = assertUrlAllowed(url)
      if (violation) return yield* violation

      const headers = new Headers(init.headers as HeadersInit | undefined)

      // Apply caller-provided headers first (lower priority than auth)
      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) {
          headers.set(k, v)
        }
      }

      // Inject Vault-backed auth token when `secret` is provided.
      if (secretName) {
        const token = yield* vault
          .readSecret(secretName)
          .pipe(
            Effect.mapError(
              (e) => new PluginError({ message: `Failed to resolve secret '${secretName}': ${e.message}`, cause: e }),
            ),
          )
        const scheme = authHeader ?? "token"
        if (scheme.toLowerCase() === "bearer" || scheme.toLowerCase() === "token") {
          headers.set("Authorization", `${scheme} ${token}`)
        } else {
          headers.set(scheme, token)
        }
      }

      const res = yield* Effect.tryPromise({
        try: () => fetch(url, { ...init, headers, signal: AbortSignal.timeout(manifest.timeoutMs) }),
        catch: (e) =>
          new PluginError({ message: `HTTP request failed: ${e instanceof Error ? e.message : String(e)}`, cause: e }),
      })
      if (!res.ok) {
        return yield* new PluginError({ message: `HTTP ${res.status} from ${url}` })
      }
      const contentType = res.headers.get("content-type") ?? ""
      if (contentType.includes("application/json")) {
        return yield* Effect.tryPromise({
          try: () => res.json(),
          catch: (e) => new PluginError({ message: "Failed to parse JSON response", cause: e }),
        })
      }
      return undefined
    })

  const mapErr = <A>(eff: Effect.Effect<A, PluginError | ScopeViolation>) =>
    eff.pipe(Effect.mapError((e) => (e instanceof PluginError ? e : new PluginError({ message: e.message, cause: e }))))

  return {
    get: (url, opts) => mapErr(doFetch(url, { method: "GET" }, opts?.secret, opts?.authHeader, opts?.headers)),
    post: (url, body, opts) =>
      mapErr(
        doFetch(
          url,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
          opts?.secret,
          opts?.authHeader,
          opts?.headers,
        ),
      ),
    put: (url, body, opts) =>
      mapErr(
        doFetch(
          url,
          { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
          opts?.secret,
          opts?.authHeader,
          opts?.headers,
        ),
      ),
    del: (url, opts) =>
      mapErr(doFetch(url, { method: "DELETE" }, opts?.secret, opts?.authHeader, opts?.headers)).pipe(Effect.asVoid),
  }
}
