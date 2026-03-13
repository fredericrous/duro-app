import { http, HttpResponse } from "msw"

const VAULT_ADDR = process.env.NAS_VAULT_ADDR ?? "http://localhost:8200"
const LLDAP_URL = process.env.LLDAP_URL ?? "http://localhost:17170"

/** Fake P12 password returned for any dev invite */
export const DEV_P12_PASSWORD = "dev-p12-s3cret"

export const handlers = [
  // ─── Vault KV: read secret (getP12Password) ───
  http.get(`${VAULT_ADDR}/v1/secret/data/pki/clients/:id`, () => {
    return HttpResponse.json({
      data: {
        data: {
          p12: "ZmFrZS1wMTItZGF0YQ==", // base64 "fake-p12-data"
          password: DEV_P12_PASSWORD,
          email: "dev@example.com",
        },
      },
    })
  }),

  // ─── Vault KV: store secret ───
  http.post(`${VAULT_ADDR}/v1/secret/data/pki/clients/:id`, () => {
    return HttpResponse.json({ data: { version: 1 } })
  }),

  // ─── Vault KV: delete secret ───
  http.delete(`${VAULT_ADDR}/v1/secret/metadata/pki/clients/:id`, () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // ─── Vault PKI: issue certificate ───
  http.post(`${VAULT_ADDR}/v1/pki-client/issue/client-cert`, () => {
    return HttpResponse.json({
      data: {
        certificate: "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----",
        private_key: "-----BEGIN RSA PRIVATE KEY-----\nFAKE\n-----END RSA PRIVATE KEY-----",
        ca_chain: ["-----BEGIN CERTIFICATE-----\nFAKE-CA\n-----END CERTIFICATE-----"],
        serial_number: "00:00:00:00:00:00:00:01",
      },
    })
  }),

  // ─── LLDAP: login ───
  http.post(`${LLDAP_URL}/auth/simple/login`, () => {
    return HttpResponse.json({ token: "dev-lldap-jwt-token" })
  }),

  // ─── LLDAP: GraphQL ───
  http.post(`${LLDAP_URL}/api/graphql`, async ({ request }) => {
    const body = (await request.json()) as { query: string }
    const query = body.query

    if (query.includes("groups")) {
      return HttpResponse.json({
        data: {
          groups: [
            { id: 1, displayName: "family" },
            { id: 2, displayName: "media" },
          ],
        },
      })
    }

    if (query.includes("users")) {
      return HttpResponse.json({
        data: {
          users: [
            { id: "admin", email: "admin@example.com", displayName: "Admin", creationDate: new Date().toISOString() },
          ],
        },
      })
    }

    if (query.includes("createUser")) {
      return HttpResponse.json({ data: { createUser: { id: "new-user" } } })
    }

    if (query.includes("addUserToGroup")) {
      return HttpResponse.json({ data: { addUserToGroup: { ok: true } } })
    }

    if (query.includes("deleteUser")) {
      return HttpResponse.json({ data: { deleteUser: { ok: true } } })
    }

    return HttpResponse.json({ data: {} })
  }),

  // ─── LLDAP: set password ───
  http.post(`${LLDAP_URL}/api/user/:userId/password`, () => {
    return new HttpResponse(null, { status: 200 })
  }),
]
