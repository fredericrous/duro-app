import { describe, expect, it } from "vitest"
import { Context, Effect, Layer, ManagedRuntime, Schedule } from "effect"

import { withConnectRetry } from "./client.server"

class Db extends Context.Tag("test/Db")<Db, { ping: () => string }>() {}

// A layer whose build fails the first `failures` times, the way PgClient.layer
// fails when Postgres is not accepting connections yet.
const flaky = (failures: number) => {
  let attempts = 0
  const layer = Layer.effect(
    Db,
    Effect.suspend(() => {
      attempts++
      return attempts <= failures
        ? Effect.fail(new Error(`connect attempt ${attempts} refused`))
        : Effect.succeed({ ping: () => `ok after ${attempts}` })
    }),
  )
  return { layer, attempts: () => attempts }
}

describe("DB layer connect retry", () => {
  it("without retry, ManagedRuntime memoizes the first failed build for good", async () => {
    const f = flaky(1)
    const rt = ManagedRuntime.make(f.layer)
    await expect(rt.runPromise(Effect.map(Db, (d) => d.ping()))).rejects.toThrow(/attempt 1 refused/)
    // The database "is back" now (the fake succeeds from attempt 2), but the
    // runtime keeps answering with the memoized failure.
    await expect(rt.runPromise(Effect.map(Db, (d) => d.ping()))).rejects.toThrow(/attempt 1 refused/)
    expect(f.attempts()).toBe(1)
    await rt.dispose()
  })

  it("with retry, the build survives a transient failure and the first query succeeds", async () => {
    const f = flaky(2)
    const rt = ManagedRuntime.make(withConnectRetry(f.layer, Schedule.recurs(5)))
    await expect(rt.runPromise(Effect.map(Db, (d) => d.ping()))).resolves.toBe("ok after 3")
    expect(f.attempts()).toBe(3)
    await rt.dispose()
  })

  it("gives up once the schedule is exhausted", async () => {
    const f = flaky(100)
    const rt = ManagedRuntime.make(withConnectRetry(f.layer, Schedule.recurs(2)))
    await expect(rt.runPromise(Effect.map(Db, (d) => d.ping()))).rejects.toThrow(/refused/)
    expect(f.attempts()).toBe(3)
    await rt.dispose()
  })
})
