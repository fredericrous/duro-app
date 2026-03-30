import { Context, Effect, Data, Layer, Schema } from "effect"
import * as HttpClient from "@effect/platform/HttpClient"
import { makeJsonApi } from "~/lib/http.server"
import { config } from "~/lib/config.server"

// ---------------------------------------------------------------------------
// Schema contract (typed response from the operator REST API)
// ---------------------------------------------------------------------------

export const ClusterApp = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  category: Schema.String,
  groups: Schema.Array(Schema.String),
  priority: Schema.Number,
})

export type ClusterApp = typeof ClusterApp.Type

const ClusterAppList = Schema.mutable(Schema.Array(ClusterApp))
const decodeClusterApps = Schema.decodeUnknown(ClusterAppList)

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class OperatorClientError extends Data.TaggedError("OperatorClientError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

export class OperatorClient extends Context.Tag("OperatorClient")<
  OperatorClient,
  {
    readonly listApps: () => Effect.Effect<ClusterApp[], OperatorClientError>
  }
>() {}

// ---------------------------------------------------------------------------
// Live implementation (calls the operator REST API)
// ---------------------------------------------------------------------------

export const OperatorClientLive = Layer.effect(
  OperatorClient,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient

    const api = makeJsonApi(
      httpClient,
      config.operatorApiUrl,
      {},
      (cause) => new OperatorClientError({ message: "Failed to call operator API", cause }),
    )

    return {
      listApps: () =>
        api
          .get("/api/v1/apps")
          .pipe(
            Effect.flatMap((raw) =>
              decodeClusterApps(raw).pipe(
                Effect.mapError(
                  (cause) => new OperatorClientError({ message: "Failed to decode operator response", cause }),
                ),
              ),
            ),
          ),
    }
  }),
)

// ---------------------------------------------------------------------------
// Dev implementation (fixture data for local development)
// ---------------------------------------------------------------------------

export const OperatorClientDev = Layer.succeed(OperatorClient, {
  listApps: () =>
    Effect.succeed([
      {
        id: "jellyfin",
        name: "Jellyfin",
        url: "https://jellyfin.local",
        category: "media",
        groups: ["media_users"],
        priority: 10,
      },
      {
        id: "navidrome",
        name: "Navidrome",
        url: "https://navidrome.local",
        category: "media",
        groups: ["media_users"],
        priority: 20,
      },
      {
        id: "vaultwarden",
        name: "Vaultwarden",
        url: "https://vaultwarden.local",
        category: "tools",
        groups: ["lldap_admin"],
        priority: 10,
      },
    ] satisfies ClusterApp[]),
})
