// @vitest-environment node
import { describe, it, expect } from "vitest"
import { buildIdentities, certBatchRevokeToast, buildBatchForm, type IdpUser } from "./identities"
import type { Principal } from "~/lib/governance/types"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"

const user = (over: Partial<IdpUser> & { id: string }): IdpUser => ({
  displayName: over.id,
  email: `${over.id}@example.com`,
  creationDate: "2024-01-01T00:00:00Z",
  ...over,
})

const principal = (over: Partial<Principal> & { id: string; principalType: string }): Principal => ({
  externalId: null,
  displayName: over.id,
  email: null,
  enabled: true,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...over,
})

const cert = (over: Partial<UserCertificate> & { serialNumber: string; username: string }): UserCertificate => ({
  id: over.serialNumber,
  inviteId: null,
  userId: null,
  email: `${over.username}@example.com`,
  label: null,
  issuedAt: "2024-01-01T00:00:00Z",
  expiresAt: "2999-01-01T00:00:00Z", // far future → active
  revokedAt: null,
  revokeState: null,
  revokeError: null,
  ...over,
})

describe("buildIdentities", () => {
  it("joins an IdP user to its governance principal on uid == external_id", () => {
    const users = [user({ id: "alice", displayName: "Alice A", email: "alice@corp.com" })]
    const principals = [principal({ id: "p-alice", principalType: "user", externalId: "alice", enabled: false })]

    const [alice] = buildIdentities(users, principals, {}, [])
    expect(alice.type).toBe("user")
    expect(alice.uid).toBe("alice")
    expect(alice.principalId).toBe("p-alice")
    expect(alice.provisioned).toBe(true)
    // Governance enabled flag wins for provisioned users.
    expect(alice.enabled).toBe(false)
    // IdP display name/email take precedence.
    expect(alice.displayName).toBe("Alice A")
    expect(alice.email).toBe("alice@corp.com")
    // The principal is consumed by the join — not emitted again as its own row.
    expect(buildIdentities(users, principals, {}, [])).toHaveLength(1)
  })

  it("surfaces an IdP user with no principal as an un-provisioned user (not hidden)", () => {
    const [bob] = buildIdentities([user({ id: "bob" })], [], {}, [])
    expect(bob.type).toBe("user")
    expect(bob.uid).toBe("bob")
    expect(bob.principalId).toBeNull()
    expect(bob.provisioned).toBe(false)
    expect(bob.enabled).toBe(true) // no governance row → treated as enabled
    expect(bob.key).toBe("user:bob")
  })

  it("emits non-user principals (group / service_account / device) as their own rows with no certs", () => {
    const principals = [
      principal({ id: "g1", principalType: "group", displayName: "Engineers" }),
      principal({ id: "sa1", principalType: "service_account", displayName: "ci-bot" }),
      principal({ id: "d1", principalType: "device", displayName: "kiosk-1" }),
    ]
    const rows = buildIdentities([], principals, {}, [])
    expect(rows.map((r) => r.type)).toEqual(["group", "service_account", "device"])
    for (const r of rows) {
      expect(r.uid).toBeNull()
      expect(r.certs).toEqual([])
      expect(r.principalId).toBe(r.key)
    }
  })

  it("emits an orphaned user-principal (uid no longer in the IdP) on its own", () => {
    const principals = [principal({ id: "p-ghost", principalType: "user", externalId: "ghost" })]
    const [ghost] = buildIdentities([], principals, {}, [])
    expect(ghost.type).toBe("user")
    expect(ghost.uid).toBe("ghost")
    expect(ghost.principalId).toBe("p-ghost")
    expect(ghost.provisioned).toBe(true)
  })

  it("counts only active certs and flags hasActiveCerts", () => {
    const certs: Record<string, UserCertificate[]> = {
      carol: [
        cert({ serialNumber: "s1", username: "carol" }), // active (far-future expiry)
        cert({ serialNumber: "s2", username: "carol", revokedAt: "2024-06-01T00:00:00Z" }), // revoked
        cert({ serialNumber: "s3", username: "carol", expiresAt: "2000-01-01T00:00:00Z" }), // expired
      ],
    }
    const [carol] = buildIdentities([user({ id: "carol" })], [], certs, [])
    expect(carol.certs).toHaveLength(3)
    expect(carol.activeCertCount).toBe(1)
    expect(carol.hasActiveCerts).toBe(true)
  })

  it("marks system users", () => {
    const [svc] = buildIdentities([user({ id: "svc-account" })], [], {}, ["svc-account"])
    expect(svc.isSystem).toBe(true)
  })

  it("orders by type (user, group, service_account, device) then display name", () => {
    const users = [user({ id: "zoe", displayName: "Zoe" }), user({ id: "amy", displayName: "Amy" })]
    const principals = [
      principal({ id: "g1", principalType: "group", displayName: "Group B" }),
      principal({ id: "sa1", principalType: "service_account", displayName: "SA" }),
    ]
    const rows = buildIdentities(users, principals, {}, [])
    expect(rows.map((r) => r.displayName)).toEqual(["Amy", "Zoe", "Group B", "SA"])
  })
})

describe("certBatchRevokeToast", () => {
  const t = (key: string, opts?: Record<string, unknown>) => `${key}:${opts?.count ?? ""}`

  it("returns an error toast when the action errored", () => {
    expect(certBatchRevokeToast({ error: "boom" }, t)).toEqual({ variant: "error", message: "boom" })
  })

  it("returns a success toast with the revoked count", () => {
    expect(certBatchRevokeToast({ certsRevoked: true, count: 3 }, t)).toEqual({
      variant: "success",
      message: "admin.users.certs.certsRevoked:3",
    })
  })

  it("returns null when there is nothing to announce", () => {
    expect(certBatchRevokeToast({}, t)).toBeNull()
  })
})

describe("buildBatchForm", () => {
  it("sets the intent and appends each value under the field", () => {
    const fd = buildBatchForm("revokeCertsBatch", "serialNumbers", ["a", "b"])
    expect(fd.get("intent")).toBe("revokeCertsBatch")
    expect(fd.getAll("serialNumbers")).toEqual(["a", "b"])
  })

  it("handles an empty value set", () => {
    const fd = buildBatchForm("revokeAllCertsBatch", "usernames", [])
    expect(fd.get("intent")).toBe("revokeAllCertsBatch")
    expect(fd.getAll("usernames")).toEqual([])
  })
})
