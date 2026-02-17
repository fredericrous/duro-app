import { Layer } from "effect"
import * as Otlp from "@effect/opentelemetry/Otlp"
import { FetchHttpClient } from "@effect/platform"

export const OtelLayer = Otlp.layerJson({
  baseUrl:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    "http://alloy.monitoring.svc.cluster.local.:4318",
  resource: {
    serviceName: process.env.OTEL_SERVICE_NAME ?? "duro",
    serviceVersion: "1.0.0",
  },
  tracerExportInterval: "5 seconds",
}).pipe(Layer.provide(FetchHttpClient.layer))
