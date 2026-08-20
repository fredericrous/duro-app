import { describe, expect, it } from "vitest"
import { deviceBudgetFrom, NEW_DEVICE_LIMIT, NEW_DEVICE_WINDOW_MS } from "./device-budget"

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0)
const agoMs = (ms: number) => new Date(NOW - ms).toISOString()
const HOUR = 60 * 60 * 1000

describe("deviceBudgetFrom", () => {
  it("counts nothing when no devices were set up", () => {
    expect(deviceBudgetFrom([], NOW)).toEqual({ used: 0, limit: NEW_DEVICE_LIMIT, nextAvailable: null })
  })

  it("allows a burst up to the limit — a new person's phone, laptop and tablet in one sitting", () => {
    const burst = [agoMs(3 * 60_000), agoMs(2 * 60_000), agoMs(60_000)]
    const budget = deviceBudgetFrom(burst, NOW)
    expect(budget.used).toBe(3)
    expect(budget.limit).toBe(3)
    // Full, and the first slot returns 24h after the FIRST of the burst.
    expect(budget.nextAvailable).toBe(new Date(NOW - 3 * 60_000 + NEW_DEVICE_WINDOW_MS).toISOString())
  })

  it("ignores devices that have aged out of the window", () => {
    const old = [agoMs(NEW_DEVICE_WINDOW_MS + HOUR), agoMs(NEW_DEVICE_WINDOW_MS + 2 * HOUR)]
    expect(deviceBudgetFrom([...old, agoMs(HOUR)], NOW)).toMatchObject({ used: 1, nextAvailable: null })
  })

  it("frees the oldest slot first, so the wait is never longer than it has to be", () => {
    // Three devices spread over the window: the earliest one ages out first.
    const spread = [agoMs(20 * HOUR), agoMs(10 * HOUR), agoMs(HOUR)]
    const budget = deviceBudgetFrom(spread, NOW)
    expect(budget.used).toBe(3)
    expect(budget.nextAvailable).toBe(new Date(NOW - 20 * HOUR + NEW_DEVICE_WINDOW_MS).toISOString())
    // ...which is 4 hours away, not 24.
    expect(new Date(budget.nextAvailable!).getTime() - NOW).toBe(4 * HOUR)
  })

  it("is not tripped by unordered input", () => {
    const unordered = [agoMs(HOUR), agoMs(20 * HOUR), agoMs(10 * HOUR)]
    expect(deviceBudgetFrom(unordered, NOW).nextAvailable).toBe(
      new Date(NOW - 20 * HOUR + NEW_DEVICE_WINDOW_MS).toISOString(),
    )
  })
})
