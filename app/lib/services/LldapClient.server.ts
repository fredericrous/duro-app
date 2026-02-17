import { Context, Effect, Data, Layer, Ref } from "effect"

export interface LldapUser {
  id: string
  email: string
  displayName: string
  creationDate: string
}

export interface LldapGroup {
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

export class LldapError extends Data.TaggedError("LldapError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class LldapClient extends Context.Tag("LldapClient")<
  LldapClient,
  {
    readonly getUsers: Effect.Effect<LldapUser[], LldapError>
    readonly getGroups: Effect.Effect<LldapGroup[], LldapError>
    readonly createUser: (input: CreateUserInput) => Effect.Effect<void, LldapError>
    readonly setUserPassword: (
      userId: string,
      password: string,
    ) => Effect.Effect<void, LldapError>
    readonly addUserToGroup: (
      userId: string,
      groupId: number,
    ) => Effect.Effect<void, LldapError>
    readonly deleteUser: (userId: string) => Effect.Effect<void, LldapError>
  }
>() {}

export const LldapClientLive = Layer.effect(
  LldapClient,
  Effect.gen(function* () {
    const url =
      process.env.LLDAP_URL ??
      "http://lldap.lldap.svc.cluster.local.:17170"
    const adminUser = process.env.LLDAP_ADMIN_USER ?? "admin"
    const adminPass = process.env.LLDAP_ADMIN_PASS ?? ""

    const tokenRef = yield* Ref.make<{
      token: string
      expiresAt: number
    } | null>(null)

    const getToken = Effect.gen(function* () {
      const cached = yield* Ref.get(tokenRef)
      if (cached && cached.expiresAt > Date.now()) {
        return cached.token
      }

      const res = yield* Effect.tryPromise({
        try: () =>
          fetch(`${url}/auth/simple/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: adminUser,
              password: adminPass,
            }),
          }).then((r) => r.json() as Promise<{ token: string }>),
        catch: (e) =>
          new LldapError({
            message: "Failed to authenticate with LLDAP",
            cause: e,
          }),
      })

      if (!res.token) {
        return yield* new LldapError({
          message: "No token in LLDAP login response",
        })
      }

      yield* Ref.set(tokenRef, {
        token: res.token,
        expiresAt: Date.now() + 50 * 60 * 1000,
      })
      return res.token
    })

    const graphql = <T = Record<string, unknown>>(
      query: string,
      variables?: Record<string, unknown>,
    ) =>
      Effect.gen(function* () {
        const token = yield* getToken
        const res = yield* Effect.tryPromise({
          try: () =>
            fetch(`${url}/api/graphql`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ query, variables }),
            }).then(
              (r) =>
                r.json() as Promise<{
                  data?: T
                  errors?: Array<{ message: string }>
                }>,
            ),
          catch: (e) =>
            new LldapError({
              message: "LLDAP GraphQL request failed",
              cause: e,
            }),
        })

        if (res.errors?.length) {
          return yield* new LldapError({
            message: `LLDAP GraphQL error: ${res.errors[0].message}`,
          })
        }

        return res.data as T
      })

    return {
      getUsers: Effect.gen(function* () {
        const data = yield* graphql<{ users: LldapUser[] }>(
          `{ users { id email displayName creationDate } }`,
        )
        return data.users ?? []
      }),

      getGroups: Effect.gen(function* () {
        const data = yield* graphql<{ groups: LldapGroup[] }>(
          `{ groups { id displayName } }`,
        )
        return data.groups ?? []
      }),

      createUser: (input: CreateUserInput) =>
        graphql(
          `mutation CreateUser($user: CreateUserInput!) { createUser(user: $user) { id } }`,
          { user: input },
        ).pipe(Effect.asVoid),

      setUserPassword: (userId: string, password: string) =>
        Effect.gen(function* () {
          const token = yield* getToken
          yield* Effect.tryPromise({
            try: () =>
              fetch(
                `${url}/api/user/${encodeURIComponent(userId)}/password`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ password }),
                },
              ).then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`)
              }),
            catch: (e) =>
              new LldapError({
                message: "Failed to set user password",
                cause: e,
              }),
          })
        }),

      addUserToGroup: (userId: string, groupId: number) =>
        graphql(
          `mutation AddUserToGroup($userId: String!, $groupId: Int!) { addUserToGroup(userId: $userId, groupId: $groupId) { ok } }`,
          { userId, groupId },
        ).pipe(Effect.asVoid),

      deleteUser: (userId: string) =>
        graphql(
          `mutation DeleteUser($userId: String!) { deleteUser(userId: $userId) { ok } }`,
          { userId },
        ).pipe(Effect.asVoid),
    }
  }),
)
