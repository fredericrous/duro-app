import { Option } from "effect"
import type { CrlMetricsSnapshot } from "~/lib/services/CrlPublisher.server"

const gauge = (name: string, help: string, value: number) =>
  `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name} ${value}\n`

/**
 * The worker's /metrics body, Prometheus text format 0.0.4. Before the first
 * good publish the three CRL gauges are absent, not 0: a 0 timestamp would
 * read as "expired" and fire the staleness alerts at every restart. The
 * pending count, read from the DB, is always present.
 */
export const formatCrlMetrics = (snapshot: CrlMetricsSnapshot): string =>
  [
    ...Option.match(snapshot.lastGood, {
      onNone: () => [],
      onSome: (cycle) => [
        gauge(
          "duro_crl_next_update_timestamp_seconds",
          "nextUpdate of the last published CRL.",
          cycle.nextUpdateSeconds,
        ),
        gauge(
          "duro_crl_published_timestamp_seconds",
          "When the last validated CRL was published (written or unchanged).",
          cycle.publishedSeconds,
        ),
        gauge(
          "duro_crl_missing_serials",
          "Completed revocations missing from the published CRL.",
          cycle.missingSerials,
        ),
      ],
    }),
    gauge(
      "duro_revocations_pending",
      "Revocations not yet done in Vault (pending or failed).",
      snapshot.pendingRevocations,
    ),
  ].join("")
