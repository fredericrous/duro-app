import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"

/**
 * Central MSW server for the whole test suite.
 *
 * Defines sensible defaults for every external HTTP boundary the app talks
 * to so individual tests rarely need to register handlers. When a test needs
 * a different response shape it calls `server.use(...)` to override just
 * the routes it cares about — see
 * https://mswjs.io/docs/best-practices/network-behavior-overrides/.
 *
 * Started once globally in `app/test/setup.ts` (NOT per-file). Lives under
 * `app/test/` so it's never bundled into production — it's only loaded by
 * test files via the setupFiles entry.
 *
 * Test base URLs match what the corresponding *Live layers expect via
 * Effect.Config (or via the config module). Keep these in sync with the
 * `process.env.*` overrides that callers set before importing the Live
 * layer.
 */

export const LLDAP_BASE = "http://lldap.test:17170"
export const VAULT_BASE = "http://vault.test:8200"
export const OPERATOR_BASE = "http://operator.test:8080"

/** Plugin tests use this generic allow-listed domain. */
export const PLUGIN_BASE = "https://api.example.com"

// ---------------------------------------------------------------------------
// Default handlers — happy-path responses for every boundary.
// Tests override specifics via `server.use(...)`.
// ---------------------------------------------------------------------------

const lldapHandlers = [
  // LLDAP auth: returns a static token. Tests that exercise the auth-failure
  // branch override this with a 401.
  http.post(`${LLDAP_BASE}/auth/simple/login`, () => HttpResponse.json({ token: "test-token" })),
  // LLDAP GraphQL: tests always override this. The default is a permissive
  // "you didn't tell me what to do" response so accidental hits surface as
  // GraphQL errors rather than network errors.
  http.post(`${LLDAP_BASE}/api/graphql`, () =>
    HttpResponse.json({
      errors: [{ message: "no default handler — override via server.use(...)" }],
    }),
  ),
]

const vaultHandlers = [
  // KV v2 reads: 404 by default — tests that want a stored secret override
  // with a `data.data` payload.
  http.get(`${VAULT_BASE}/v1/secret/data/pki/clients/:id`, () =>
    HttpResponse.json({ errors: ["not found"] }, { status: 404 }),
  ),
  // KV v2 writes: 204 by default; tests assert on request body instead of
  // response shape.
  http.post(`${VAULT_BASE}/v1/secret/data/pki/clients/:id`, () => HttpResponse.json({}, { status: 200 })),
  // KV v2 metadata delete (the "destroy the secret" path).
  http.delete(`${VAULT_BASE}/v1/secret/metadata/pki/clients/:id`, () => HttpResponse.json({}, { status: 204 })),
  // PKI revoke endpoint.
  http.post(`${VAULT_BASE}/v1/pki-client/revoke`, () => HttpResponse.json({ data: {} })),
]

const operatorHandlers = [
  // Default: empty apps list. Tests override to seed fixtures.
  http.get(`${OPERATOR_BASE}/api/v1/apps`, () => HttpResponse.json([])),
]

// ---------------------------------------------------------------------------
// Server export
// ---------------------------------------------------------------------------

export const server = setupServer(...lldapHandlers, ...vaultHandlers, ...operatorHandlers)

// Re-export the building blocks so test files import everything from one place.
export { http, HttpResponse }
