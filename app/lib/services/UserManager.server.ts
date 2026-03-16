import { Context, Effect, Data, Layer } from "effect"

export interface ManagedUser {
  id: string
  email: string
  displayName: string
  creationDate: string
}

export interface ManagedGroup {
  id: number
  displayName: string
}

export interface CreateUserInput {
  id: string
  email: string
  displayName: string
  firstName: string
  lastName: string
}

export class UserManagerError extends Data.TaggedError("UserManagerError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class UserManager extends Context.Tag("UserManager")<
  UserManager,
  {
    readonly getUsers: Effect.Effect<ManagedUser[], UserManagerError>
    readonly getGroups: Effect.Effect<ManagedGroup[], UserManagerError>
    readonly createUser: (input: CreateUserInput) => Effect.Effect<void, UserManagerError>
    readonly setUserPassword: (userId: string, password: string) => Effect.Effect<void, UserManagerError>
    readonly addUserToGroup: (userId: string, groupId: number) => Effect.Effect<void, UserManagerError>
    readonly deleteUser: (userId: string) => Effect.Effect<void, UserManagerError>
  }
>() {}

// ---------------------------------------------------------------------------
// Dev fake — in-memory user directory, no LLDAP needed
// ---------------------------------------------------------------------------

const devUsers = new Map<string, ManagedUser>([
  ["dev", { id: "dev", email: "dev@localhost", displayName: "Dev User", creationDate: "2025-01-01T00:00:00Z" }],
  ["alice", { id: "alice", email: "alice@example.com", displayName: "Alice", creationDate: "2025-02-01T00:00:00Z" }],
  ["bob", { id: "bob", email: "bob@example.com", displayName: "Bob", creationDate: "2025-03-01T00:00:00Z" }],
])

const devGroups: ManagedGroup[] = [
  { id: 1, displayName: "family" },
  { id: 2, displayName: "media" },
  { id: 3, displayName: "lldap_admin" },
]

export const UserManagerDev = Layer.succeed(UserManager, {
  getUsers: Effect.succeed([...devUsers.values()]),

  getGroups: Effect.succeed(devGroups),

  createUser: (input) => {
    devUsers.set(input.id, {
      id: input.id,
      email: input.email,
      displayName: input.displayName,
      creationDate: new Date().toISOString(),
    })
    return Effect.log(`[DEV] Created user ${input.id}`)
  },

  setUserPassword: (userId, _password) => Effect.log(`[DEV] Set password for ${userId}`),

  addUserToGroup: (userId, groupId) => Effect.log(`[DEV] Added ${userId} to group ${groupId}`),

  deleteUser: (userId) => {
    devUsers.delete(userId)
    return Effect.log(`[DEV] Deleted user ${userId}`)
  },
})
