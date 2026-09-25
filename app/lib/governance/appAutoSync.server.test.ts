// @vitest-environment node
import { describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import { AppSyncError, AppSyncService, type ConditionalSyncResult } from "./AppSyncService.server"
import { makeAppAutoSync } from "./appAutoSync.server"

const result = { created: 0, updated: 0, disabled: 0, total: 1 }

/** A sync service that records the ETag it was asked with and answers from a script. */
const fakeSync = (answers: Array<ConditionalSyncResult | "fail">) => {
  const asked: Array<string | null> = []
  const layer = Layer.succeed(AppSyncService, {
    syncFromCluster: () => Effect.succeed(result),
    syncIfChanged: (etag) => {
      asked.push(etag)
      const next = answers.shift() ?? { changed: false }
      return next === "fail" ? Effect.fail(new AppSyncError({ message: "operator down" })) : Effect.succeed(next)
    },
  })
  return { layer, asked }
}

const run = (tick: Effect.Effect<ConditionalSyncResult, never, AppSyncService>, layer: Layer.Layer<AppSyncService>) =>
  Effect.runPromise(Effect.provide(tick, layer))

describe("app auto-sync", () => {
  it("remembers the ETag, so an unchanged list is a cheap no-op", async () => {
    const { layer, asked } = fakeSync([{ changed: true, result, etag: '"v1"' }, { changed: false }])
    const tick = makeAppAutoSync({ forceEvery: 100 })
    await run(tick, layer)
    await run(tick, layer)
    expect(asked).toEqual([null, '"v1"'])
  })

  it("forces a full sync every N ticks", async () => {
    const { layer, asked } = fakeSync([{ changed: true, result, etag: '"v1"' }])
    const tick = makeAppAutoSync({ forceEvery: 3 })
    for (let i = 0; i < 4; i++) await run(tick, layer)
    expect(asked).toEqual([null, '"v1"', '"v1"', null])
  })

  it("survives a failed tick and keeps the last good ETag", async () => {
    const { layer, asked } = fakeSync([{ changed: true, result, etag: '"v1"' }, "fail", { changed: false }])
    const tick = makeAppAutoSync({ forceEvery: 100 })
    await run(tick, layer)
    await expect(run(tick, layer)).resolves.toEqual({ changed: false })
    await run(tick, layer)
    expect(asked).toEqual([null, '"v1"', '"v1"'])
  })
})
