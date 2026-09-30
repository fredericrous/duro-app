import { Context, Effect, Data, Layer, Schema } from "effect"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
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

/**
 * A conditional read of the app list. The operator tags the list with an ETag
 * that changes only when some DashboardApp does, so a poller can ask cheaply and
 * run a sync only on a real change.
 */
export type AppsIfChanged =
  | { readonly changed: false }
  | { readonly changed: true; readonly apps: ClusterApp[]; readonly etag: string | null }

export class OperatorClient extends Context.Tag("OperatorClient")<
  OperatorClient,
  {
    readonly listApps: () => Effect.Effect<ClusterApp[], OperatorClientError>
    /** GET with If-None-Match: `{ changed: false }` on 304, else the apps and their ETag. */
    readonly listAppsIfChanged: (etag: string | null) => Effect.Effect<AppsIfChanged, OperatorClientError>
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

    const listAppsIfChanged = (etag: string | null) =>
      httpClient
        .execute(
          HttpClientRequest.get(`${config.operatorApiUrl}/api/v1/apps`).pipe(
            HttpClientRequest.setHeaders(etag ? { "If-None-Match": etag } : {}),
          ),
        )
        .pipe(
          Effect.flatMap((response) => {
            if (response.status === 304) return Effect.succeed<AppsIfChanged>({ changed: false })
            if (response.status < 200 || response.status >= 300) {
              return Effect.fail(new OperatorClientError({ message: `Operator API returned ${response.status}` }))
            }
            return response.json.pipe(
              Effect.mapError(
                (cause) => new OperatorClientError({ message: "Failed to read operator response", cause }),
              ),
              Effect.flatMap((raw) =>
                decodeClusterApps(raw).pipe(
                  Effect.mapError(
                    (cause) => new OperatorClientError({ message: "Failed to decode operator response", cause }),
                  ),
                ),
              ),
              Effect.map((apps): AppsIfChanged => ({ changed: true, apps, etag: response.headers["etag"] ?? null })),
            )
          }),
          Effect.catchTag("RequestError", (cause) =>
            Effect.fail(new OperatorClientError({ message: "Failed to call operator API", cause })),
          ),
          Effect.catchTag("ResponseError", (cause) =>
            Effect.fail(new OperatorClientError({ message: "Failed to call operator API", cause })),
          ),
          Effect.scoped,
        )

    return {
      listAppsIfChanged,
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

const devApps: ClusterApp[] = [
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
] satisfies ClusterApp[]

export const OperatorClientDev = Layer.succeed(OperatorClient, {
  listApps: () => Effect.succeed(devApps),
  listAppsIfChanged: (etag) =>
    Effect.succeed<AppsIfChanged>(etag === "dev" ? { changed: false } : { changed: true, apps: devApps, etag: "dev" }),
})
