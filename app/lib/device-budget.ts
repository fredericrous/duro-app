/**
 * How many NEW devices an account may set up, and how fast.
 *
 * The control exists to bound one thing: how many long-lived credentials
 * someone who briefly holds your session can walk away with. Each device cert
 * outlives the session and the password that created it, so the ceiling is a
 * real security parameter — but a limit of one per day was the wrong SHAPE.
 * Device setup is bursty and rare (a new person arrives with a phone, a
 * laptop and a tablet, then nothing for months), so a rate that only ever
 * allows one made the common case take three days while barely changing what
 * an attacker gets in the five minutes they actually have.
 *
 * A rolling window of live certificates fixes the shape without raising the
 * per-session take much: at most LIMIT unrevoked new-device certs issued in
 * the last WINDOW. Counting the CERTIFICATES rather than a stored counter
 * means the ledger self-corrects — revoking one of today's devices frees its
 * slot immediately (the undo case), while revoking an older device frees
 * nothing, because it was never inside the window. There is no exchange rate
 * to farm.
 */
export const NEW_DEVICE_LIMIT = 3
export const NEW_DEVICE_WINDOW_MS = 24 * 60 * 60 * 1000

export interface DeviceBudget {
  /** Live new-device certs inside the window. */
  used: number
  limit: number
  /** When the oldest slot frees up; null while slots remain. */
  nextAvailable: string | null
}

/**
 * Derive the budget from the issue times of the certs currently occupying it.
 * Pure so both the loader and the issue path agree without a round-trip.
 */
export function deviceBudgetFrom(issuedAt: readonly (string | Date)[], now = Date.now()): DeviceBudget {
  const cutoff = now - NEW_DEVICE_WINDOW_MS
  const inWindow = issuedAt
    .map((d) => new Date(d).getTime())
    .filter((t) => t > cutoff)
    .sort((a, b) => a - b)
  const used = inWindow.length
  // The oldest occupant is the one that ages out first, freeing its slot.
  const nextAvailable = used >= NEW_DEVICE_LIMIT ? new Date(inWindow[0] + NEW_DEVICE_WINDOW_MS).toISOString() : null
  return { used, limit: NEW_DEVICE_LIMIT, nextAvailable }
}
