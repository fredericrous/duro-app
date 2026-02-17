import { Context, Effect, Layer } from "effect"

export class EventBrokerError {
  readonly _tag = "EventBrokerError"
  constructor(readonly message: string) {}
}

export class EventBroker extends Context.Tag("EventBroker")<
  EventBroker,
  {
    readonly emit: (
      type: string,
      source: string,
      id: string,
      data: unknown,
    ) => Effect.Effect<void, EventBrokerError>
  }
>() {}

const KNATIVE_BROKER_URL =
  process.env.KNATIVE_BROKER_URL ??
  "http://broker-ingress.knative-eventing.svc.cluster.local/duro/default"

export const EventBrokerLive = Layer.succeed(EventBroker, {
  emit: (type, source, id, data) =>
    Effect.tryPromise({
      try: () =>
        fetch(KNATIVE_BROKER_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/cloudevents+json; charset=UTF-8",
          },
          body: JSON.stringify({
            specversion: "1.0",
            type,
            source,
            id,
            datacontenttype: "application/json",
            data,
          }),
        }).then((res) => {
          if (!res.ok) {
            throw new Error(
              `Broker returned ${res.status}: ${res.statusText}`,
            )
          }
        }),
      catch: (e) =>
        new EventBrokerError(
          e instanceof Error ? e.message : "Failed to emit event",
        ),
    }),
})
