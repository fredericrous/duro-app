import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"

export class PreferencesError extends Data.TaggedError("PreferencesError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class PreferencesRepo extends Context.Tag("PreferencesRepo")<
  PreferencesRepo,
  {
    /** Returns the user's locale, falling back to "en" on any error. */
    readonly getLocale: (username: string) => Effect.Effect<string>
    readonly setLocale: (username: string, locale: string) => Effect.Effect<void, PreferencesError>
    readonly getLastCertRenewal: (
      username: string,
    ) => Effect.Effect<{ at: Date | null; renewalId: string | null }>
    readonly setCertRenewal: (username: string, renewalId: string) => Effect.Effect<void, PreferencesError>
    readonly clearCertRenewalId: (username: string) => Effect.Effect<void, PreferencesError>
  }
>() {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new PreferencesError({ message, cause: e })))

export const PreferencesRepoLive = Layer.effect(
  PreferencesRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      getLocale: (username: string) =>
        sql`SELECT locale FROM user_preferences WHERE username = ${username}`.pipe(
          Effect.map((rows) => {
            const locale = rows[0]?.locale
            return typeof locale === "string" ? locale : "en"
          }),
          Effect.catchAll(() => Effect.succeed("en")),
        ),

      setLocale: (username: string, locale: string) =>
        withErr(
          sql`INSERT INTO user_preferences (username, locale, updated_at) VALUES (${username}, ${locale}, NOW())
              ON CONFLICT(username) DO UPDATE SET locale = ${locale}, updated_at = NOW()`.pipe(Effect.asVoid),
          "Failed to set locale",
        ),

      getLastCertRenewal: (username: string) =>
        sql`SELECT last_cert_renewal_at, cert_renewal_id FROM user_preferences WHERE username = ${username}`.pipe(
          Effect.map((rows) => {
            const row = rows[0]
            if (!row) return { at: null, renewalId: null }
            const at = row.last_cert_renewal_at ? new Date(row.last_cert_renewal_at as string) : null
            const renewalId = (row.cert_renewal_id as string) ?? null
            return { at, renewalId }
          }),
          Effect.catchAll(() => Effect.succeed({ at: null, renewalId: null })),
        ),

      setCertRenewal: (username: string, renewalId: string) =>
        withErr(
          sql`INSERT INTO user_preferences (username, locale, updated_at, last_cert_renewal_at, cert_renewal_id)
              VALUES (${username}, 'en', NOW(), NOW(), ${renewalId})
              ON CONFLICT(username) DO UPDATE SET last_cert_renewal_at = NOW(), cert_renewal_id = ${renewalId}, updated_at = NOW()`.pipe(
            Effect.asVoid,
          ),
          "Failed to set cert renewal",
        ),

      clearCertRenewalId: (username: string) => {
        const stmt = sql`UPDATE user_preferences SET cert_renewal_id = NULL WHERE username = ${username}`
        return withErr(stmt.pipe(Effect.asVoid), "Failed to clear cert renewal ID")
      },
    }
  }),
)
