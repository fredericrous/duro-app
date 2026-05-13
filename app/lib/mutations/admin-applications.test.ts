// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { handleAdminApplicationsMutation, parseAdminApplicationsMutation } from "./admin-applications"
import { seedTestDb, testRunEffect, truncateAll } from "~/test/test-runtime"

beforeEach(async () => {
  await truncateAll()
})

// =============================================================================
// parseAdminApplicationsMutation — pure FormData parsing, no DB needed
// =============================================================================

function fd(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.append(k, v)
  return f
}

describe("parseAdminApplicationsMutation", () => {
  it("parses syncFromCluster (no extra fields required)", () => {
    expect(parseAdminApplicationsMutation(fd({ intent: "syncFromCluster" }))).toEqual({
      intent: "syncFromCluster",
    })
  })

  it("parses update with optional fields preserved as undefined", () => {
    const result = parseAdminApplicationsMutation(fd({ intent: "update", id: "app-1" }))
    expect(result).toEqual({
      intent: "update",
      id: "app-1",
      displayName: undefined,
      description: undefined,
      accessMode: undefined,
      enabled: undefined,
      ownerId: undefined,
    })
  })

  it("parses update's enabled flag as a boolean ('true'/'false' → true/false)", () => {
    const trueCase = parseAdminApplicationsMutation(fd({ intent: "update", id: "app-1", enabled: "true" }))
    const falseCase = parseAdminApplicationsMutation(fd({ intent: "update", id: "app-1", enabled: "false" }))
    expect((trueCase as { enabled: boolean }).enabled).toBe(true)
    expect((falseCase as { enabled: boolean }).enabled).toBe(false)
  })

  it("rejects update without id", () => {
    expect(parseAdminApplicationsMutation(fd({ intent: "update" }))).toEqual({
      error: "Missing application id",
    })
  })

  it("rejects delete without id", () => {
    expect(parseAdminApplicationsMutation(fd({ intent: "delete" }))).toEqual({
      error: "Missing application id",
    })
  })

  it("parses createRole with all required fields", () => {
    const result = parseAdminApplicationsMutation(
      fd({
        intent: "createRole",
        applicationId: "app-1",
        slug: "editor",
        displayName: "Editor",
        description: "Can edit",
      }),
    )
    expect(result).toEqual({
      intent: "createRole",
      applicationId: "app-1",
      slug: "editor",
      displayName: "Editor",
      description: "Can edit",
    })
  })

  it("rejects createRole when any required field is missing", () => {
    expect(parseAdminApplicationsMutation(fd({ intent: "createRole", applicationId: "app-1", slug: "x" }))).toEqual({
      error: "Missing applicationId, slug, or displayName",
    })
  })

  it("rejects createEntitlement when any required field is missing", () => {
    expect(
      parseAdminApplicationsMutation(fd({ intent: "createEntitlement", slug: "edit", displayName: "Edit" })),
    ).toEqual({ error: "Missing applicationId, slug, or displayName" })
  })

  it("rejects unknown intents", () => {
    expect(parseAdminApplicationsMutation(fd({ intent: "explode" }))).toEqual({
      error: "Unknown action",
    })
  })
})

// =============================================================================
// handleAdminApplicationsMutation — exercises real DB via the test runtime
// =============================================================================

const seedAppAndOwner = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`INSERT INTO principals (id, principal_type, external_id, display_name, email)
             VALUES ('p-owner', 'user', 'owner', 'Owner', 'o@x')`
  yield* sql`INSERT INTO applications (id, slug, display_name, access_mode, owner_id)
             VALUES ('app-1', 'app-1', 'App 1', 'request', 'p-owner')`
})

describe("handleAdminApplicationsMutation — update", () => {
  it("changes only the provided fields, leaves others untouched", async () => {
    await seedTestDb(seedAppAndOwner)

    const result = await testRunEffect(
      handleAdminApplicationsMutation({
        intent: "update",
        id: "app-1",
        displayName: "Renamed",
      }),
    )

    expect(result).toEqual({ success: true, message: "Application updated" })

    // Verify the DB actually changed.
    const row = await testRunEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ displayName: string; accessMode: string }>`
          SELECT display_name, access_mode FROM applications WHERE id = 'app-1'`
        return rows[0]
      }),
    )
    expect(row?.displayName).toBe("Renamed")
    expect(row?.accessMode).toBe("request") // untouched
  })

  it("can flip enabled to false", async () => {
    await seedTestDb(seedAppAndOwner)

    const result = await testRunEffect(
      handleAdminApplicationsMutation({ intent: "update", id: "app-1", enabled: false }),
    )
    expect("success" in result).toBe(true)

    const row = await testRunEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ enabled: boolean }>`
          SELECT enabled FROM applications WHERE id = 'app-1'`
        return rows[0]
      }),
    )
    expect(row?.enabled).toBe(false)
  })
})

describe("handleAdminApplicationsMutation — createRole / createEntitlement", () => {
  it("createRole inserts a row and returns the display name in the message", async () => {
    await seedTestDb(seedAppAndOwner)

    const result = await testRunEffect(
      handleAdminApplicationsMutation({
        intent: "createRole",
        applicationId: "app-1",
        slug: "editor",
        displayName: "Editor",
      }),
    )

    expect(result).toEqual({ success: true, message: 'Role "Editor" created' })

    const rows = await testRunEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ slug: string }>`SELECT slug FROM roles WHERE application_id = 'app-1'`
      }),
    )
    expect(rows.map((r) => r.slug)).toEqual(["editor"])
  })

  it("createEntitlement inserts a row and returns the display name in the message", async () => {
    await seedTestDb(seedAppAndOwner)

    const result = await testRunEffect(
      handleAdminApplicationsMutation({
        intent: "createEntitlement",
        applicationId: "app-1",
        slug: "edit",
        displayName: "Edit",
      }),
    )

    expect(result).toEqual({ success: true, message: 'Entitlement "Edit" created' })

    const rows = await testRunEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ slug: string }>`SELECT slug FROM entitlements WHERE application_id = 'app-1'`
      }),
    )
    expect(rows.map((r) => r.slug)).toEqual(["edit"])
  })
})

describe("handleAdminApplicationsMutation — delete", () => {
  it("returns success but is a documented no-op", async () => {
    const result = await testRunEffect(handleAdminApplicationsMutation({ intent: "delete", id: "app-1" }))
    expect(result).toEqual({ success: true, message: "Delete not implemented yet" })
  })
})

describe("handleAdminApplicationsMutation — error surface", () => {
  it("converts a thrown SqlError into an {error: ...} shape (catchAll branch)", async () => {
    // createRole against an app that doesn't exist → FK violation → catchAll
    // wraps it into the result error shape rather than throwing.
    const result = await testRunEffect(
      handleAdminApplicationsMutation({
        intent: "createRole",
        applicationId: "nonexistent",
        slug: "x",
        displayName: "X",
      }),
    )
    expect("error" in result).toBe(true)
  })
})
