#!/usr/bin/env -S npx tsx
/**
 * Mint a duro API key for a principal. Prints the raw key once on stdout
 * (capture it — it's not retrievable later, only the hash is stored).
 *
 *   tsx scripts/mint-api-key.ts <principalExternalId> <name> [--expires-in-days <n>] [scope ...]
 *
 * Examples:
 *   tsx scripts/mint-api-key.ts admin claude-mcp invites:create
 *   tsx scripts/mint-api-key.ts admin ci-bot --expires-in-days 90 invites:create
 *   tsx scripts/mint-api-key.ts dev local-cli '*'
 *
 * Requires DATABASE_URL in env (same Postgres the running app uses). For
 * everyday minting, prefer the /settings page in the UI; this script exists
 * as the bootstrap fallback (no UI reachable yet) and for ops automation.
 */
import { Effect, Layer, ManagedRuntime } from "effect"
import { ApiKeyRepo, ApiKeyRepoLive } from "~/lib/governance/ApiKeyRepo.server"
import { PrincipalRepo, PrincipalRepoLive } from "~/lib/governance/PrincipalRepo.server"
import { DbLive } from "~/lib/db/client.server"

const argv = process.argv.slice(2)
let expiresInDays: number | null = null
const positional: string[] = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--expires-in-days") {
    const next = argv[++i]
    const n = Number(next)
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`Invalid --expires-in-days value: ${next}`)
      process.exit(1)
    }
    expiresInDays = n
  } else {
    positional.push(argv[i])
  }
}
const [externalId, name, ...scopes] = positional
if (!externalId || !name) {
  console.error(
    "Usage: tsx scripts/mint-api-key.ts <principalExternalId> <name> [--expires-in-days <n>] [scope ...]",
  )
  process.exit(1)
}
if (scopes.length === 0) {
  console.error("Error: at least one scope is required (e.g. invites:create, or '*' for all)")
  process.exit(1)
}

const Layered = Layer.mergeAll(PrincipalRepoLive, ApiKeyRepoLive).pipe(Layer.provideMerge(DbLive))
const runtime = ManagedRuntime.make(Layered)

const program = Effect.gen(function* () {
  const principals = yield* PrincipalRepo
  const principal = yield* principals.findByExternalId(externalId)
  if (!principal) {
    return yield* Effect.fail(`No principal with externalId="${externalId}"`)
  }
  const keys = yield* ApiKeyRepo
  return yield* keys.create({ principalId: principal.id, name, scopes, expiresInDays })
})

runtime
  .runPromise(program)
  .then(async (result) => {
    console.log(result.rawKey)
    await runtime.dispose()
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : String(err))
    await runtime.dispose()
    process.exit(1)
  })
