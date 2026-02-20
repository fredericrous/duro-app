import { Context, Effect, Data } from "effect"

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
