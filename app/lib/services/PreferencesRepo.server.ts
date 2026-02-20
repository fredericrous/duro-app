import { Context, Effect, Data, Layer } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan, currentDialect } from "~/lib/db/client.server"

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

      setLocale: (username: string, locale: string) => {
        const now = new Date().toISOString()
        const upsert =
          currentDialect === "sqlite"
            ? sql`INSERT INTO user_preferences (username, locale, updated_at) VALUES (${username}, ${locale}, ${now})
                  ON CONFLICT(username) DO UPDATE SET locale = ${locale}, updated_at = ${now}`
            : sql`INSERT INTO user_preferences (username, locale, updated_at) VALUES (${username}, ${locale}, NOW())
                  ON CONFLICT(username) DO UPDATE SET locale = ${locale}, updated_at = NOW()`
        return withErr(upsert.pipe(Effect.asVoid), "Failed to set locale")
      },
    }
  }),
)
