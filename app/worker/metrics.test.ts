import { describe, expect, it } from "vitest"
import { Option } from "effect"
import { formatCrlMetrics } from "./metrics"

describe("formatCrlMetrics", () => {
  it("omits the CRL gauges before the first good publish, always shows the pending count", () => {
    const body = formatCrlMetrics({ lastGood: Option.none(), pendingRevocations: 2 })
    expect(body).not.toContain("duro_crl_")
    expect(body).toContain("# TYPE duro_revocations_pending gauge\nduro_revocations_pending 2\n")
  })

  it("shows all four gauges after a good publish", () => {
    const body = formatCrlMetrics({
      lastGood: Option.some({ nextUpdateSeconds: 1796272455, publishedSeconds: 1795667656, missingSerials: 0 }),
      pendingRevocations: 0,
    })
    expect(body).toMatch(/^duro_crl_next_update_timestamp_seconds 1796272455$/m)
    expect(body).toMatch(/^duro_crl_published_timestamp_seconds 1795667656$/m)
    expect(body).toMatch(/^duro_crl_missing_serials 0$/m)
    expect(body).toMatch(/^duro_revocations_pending 0$/m)
  })
})
