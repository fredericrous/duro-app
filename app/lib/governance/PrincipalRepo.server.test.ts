import { describe, expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { makeTestDbLayer } from "~/lib/db/client.server"
import { PrincipalRepo, PrincipalRepoLive } from "./PrincipalRepo.server"

const TestLayer = PrincipalRepoLive.pipe(Layer.provideMerge(makeTestDbLayer()))

describe("PrincipalRepo", () => {
  it.layer(TestLayer)("PrincipalRepo", (it) => {
    it.effect("ensureUser creates a new user and returns it with correct fields", () =>
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        const principal = yield* repo.ensureUser("ext-1", "Alice", "alice@example.com")

        expect(principal.principalType).toBe("user")
        expect(principal.externalId).toBe("ext-1")
        expect(principal.displayName).toBe("Alice")
        expect(principal.email).toBe("alice@example.com")
        expect(principal.id).toBeDefined()
        expect(principal.enabled).toBe(true)
        expect(principal.createdAt).toBeDefined()
        expect(principal.updatedAt).toBeDefined()
      }),
    )

    it.effect("ensureUser is idempotent — same externalId returns same id with updated fields", () =>
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        const first = yield* repo.ensureUser("ext-idem", "Bob", "bob@example.com")
        const second = yield* repo.ensureUser("ext-idem", "Robert", "robert@example.com")

        expect(second.id).toBe(first.id)
        expect(second.displayName).toBe("Robert")
        expect(second.email).toBe("robert@example.com")
      }),
    )

    it.effect("findByExternalId returns null for non-existent user", () =>
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        const result = yield* repo.findByExternalId("does-not-exist")

        expect(result).toBeNull()
      }),
    )

    it.effect("findByExternalId returns the correct principal after ensureUser", () =>
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        const created = yield* repo.ensureUser("ext-find", "Charlie", "charlie@example.com")
        const found = yield* repo.findByExternalId("ext-find")

        expect(found).not.toBeNull()
        expect(found!.id).toBe(created.id)
        expect(found!.displayName).toBe("Charlie")
        expect(found!.email).toBe("charlie@example.com")
      }),
    )

    it.effect("createGroup creates a group principal", () =>
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        const group = yield* repo.createGroup("Admins", "group-ext-1")

        expect(group.principalType).toBe("group")
        expect(group.displayName).toBe("Admins")
        expect(group.externalId).toBe("group-ext-1")
        expect(group.id).toBeDefined()
        expect(group.enabled).toBe(true)
      }),
    )

    it.effect("addMembership + listGroupsFor — returns the group for a member", () =>
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        const user = yield* repo.ensureUser("ext-member-1", "Dana", "dana@example.com")
        const group = yield* repo.createGroup("Engineers")

        yield* repo.addMembership(group.id, user.id)
        const groups = yield* repo.listGroupsFor(user.id)

        expect(groups).toHaveLength(1)
        expect(groups[0].id).toBe(group.id)
        expect(groups[0].displayName).toBe("Engineers")
      }),
    )

    it.effect("addMembership + listMembers — returns the user in the group", () =>
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        const user = yield* repo.ensureUser("ext-member-2", "Eve", "eve@example.com")
        const group = yield* repo.createGroup("Designers")

        yield* repo.addMembership(group.id, user.id)
        const members = yield* repo.listMembers(group.id)

        expect(members).toHaveLength(1)
        expect(members[0].id).toBe(user.id)
        expect(members[0].displayName).toBe("Eve")
      }),
    )

    it.effect("removeMembership — after removing, listGroupsFor returns empty", () =>
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        const user = yield* repo.ensureUser("ext-member-3", "Frank", "frank@example.com")
        const group = yield* repo.createGroup("Testers")

        yield* repo.addMembership(group.id, user.id)
        yield* repo.removeMembership(group.id, user.id)
        const groups = yield* repo.listGroupsFor(user.id)

        expect(groups).toHaveLength(0)
      }),
    )

    it.effect("disable — after disabling, findById returns principal with enabled = false", () =>
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        const user = yield* repo.ensureUser("ext-disable", "Grace", "grace@example.com")

        expect(user.enabled).toBe(true)

        yield* repo.disable(user.id)
        const found = yield* repo.findById(user.id)

        expect(found).not.toBeNull()
        expect(found!.enabled).toBe(false)
      }),
    )

    it.effect("list — returns all created principals", () =>
      Effect.gen(function* () {
        const repo = yield* PrincipalRepo
        const user1 = yield* repo.ensureUser("ext-list-1", "Hank", "hank@example.com")
        const user2 = yield* repo.ensureUser("ext-list-2", "Ivy", "ivy@example.com")
        const group = yield* repo.createGroup("AllStaff")

        const all = yield* repo.list()

        const ids = all.map((p) => p.id)
        expect(ids).toContain(user1.id)
        expect(ids).toContain(user2.id)
        expect(ids).toContain(group.id)
      }),
    )
  })
})
