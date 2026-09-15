import { Context, Effect, Data, Layer, ParseResult } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import * as SqlError from "@effect/sql/SqlError"
import { MigrationsRan } from "~/lib/db/client.server"
import { decodeApprovalPolicy, type ApprovalMode, type ApprovalPolicy, type ApprovalPolicyRule } from "./types"
import type { GateScopeType } from "./approval-gates"

export class ApprovalPolicyRepoError extends Data.TaggedError("ApprovalPolicyRepoError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

const withErr = <A>(effect: Effect.Effect<A, SqlError.SqlError | ParseResult.ParseError>, message: string) =>
  effect.pipe(Effect.mapError((e) => new ApprovalPolicyRepoError({ message, cause: e })))

export interface UpsertApprovalPolicyInput {
  readonly applicationId: string
  readonly scopeType: GateScopeType
  /** null for the application-wide policy. */
  readonly scopeId: string | null
  readonly mode: ApprovalMode
  readonly rules: ReadonlyArray<ApprovalPolicyRule>
}

/**
 * Admin-side access to approval_policies. The request workflow keeps reading
 * through AccessRequestRepo.findApprovalPolicy (most-specific-scope lookup);
 * this repo owns the write side and the per-application listing the gate
 * board renders.
 */
export class ApprovalPolicyRepo extends Context.Tag("ApprovalPolicyRepo")<
  ApprovalPolicyRepo,
  {
    readonly listByApplication: (applicationId: string) => Effect.Effect<ApprovalPolicy[], ApprovalPolicyRepoError>
    /** One policy per (application, scope): inserts or replaces in place. */
    readonly upsert: (input: UpsertApprovalPolicyInput) => Effect.Effect<ApprovalPolicy, ApprovalPolicyRepoError>
    /** Returns true when a policy existed and was removed. */
    readonly deleteByScope: (
      applicationId: string,
      scopeType: GateScopeType,
      scopeId: string | null,
    ) => Effect.Effect<boolean, ApprovalPolicyRepoError>
  }
>() {}

export const ApprovalPolicyRepoLive = Layer.effect(
  ApprovalPolicyRepo,
  Effect.gen(function* () {
    yield* MigrationsRan
    const sql = yield* SqlClient.SqlClient

    return {
      listByApplication: (applicationId) =>
        withErr(
          sql`SELECT * FROM approval_policies
              WHERE application_id = ${applicationId}
              ORDER BY CASE scope_type WHEN 'application' THEN 0 WHEN 'role' THEN 1 ELSE 2 END, created_at`.pipe(
            Effect.flatMap((rows) => Effect.forEach(rows, decodeApprovalPolicy)),
          ),
          "Failed to list approval policies",
        ),

      upsert: (input) =>
        Effect.gen(function* () {
          const rulesJson = JSON.stringify(input.rules)
          // The conflict target is the expression index from migration 0037;
          // it must match that expression exactly or Postgres rejects the
          // statement instead of upserting.
          const rows = yield* withErr(
            sql`INSERT INTO approval_policies (application_id, scope_type, scope_id, mode, rules)
                VALUES (${input.applicationId}, ${input.scopeType}, ${input.scopeId}, ${input.mode}, ${rulesJson}::jsonb)
                ON CONFLICT (application_id, scope_type, COALESCE(scope_id, ''))
                DO UPDATE SET mode = EXCLUDED.mode, rules = EXCLUDED.rules, updated_at = NOW()
                RETURNING *`,
            "Failed to save approval policy",
          )
          return yield* withErr(decodeApprovalPolicy(rows[0]), "Failed to save approval policy")
        }),

      deleteByScope: (applicationId, scopeType, scopeId) =>
        withErr(
          sql`DELETE FROM approval_policies
              WHERE application_id = ${applicationId}
                AND scope_type = ${scopeType}
                AND COALESCE(scope_id, '') = COALESCE(${scopeId}::text, '')
              RETURNING id`.pipe(Effect.map((rows) => rows.length > 0)),
          "Failed to delete approval policy",
        ),
    }
  }),
)
