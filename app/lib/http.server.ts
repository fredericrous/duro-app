import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import * as HttpClientResponse from "@effect/platform/HttpClientResponse"
import { Effect } from "effect"

export const makeJsonApi = <E>(
  client: HttpClient.HttpClient,
  baseUrl: string,
  defaultHeaders: Record<string, string>,
  mapError: (cause: unknown) => E,
) => {
  const exec = (req: HttpClientRequest.HttpClientRequest) =>
    client.execute(
      req.pipe(
        HttpClientRequest.prependUrl(baseUrl),
        HttpClientRequest.setHeaders(defaultHeaders),
      ),
    ).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((r) => r.json),
      Effect.mapError(mapError),
      Effect.scoped,
    )

  return {
    get: (path: string) =>
      exec(HttpClientRequest.get(path)),
    post: (path: string, body?: unknown) =>
      exec(
        body !== undefined
          ? HttpClientRequest.post(path).pipe(HttpClientRequest.bodyUnsafeJson(body))
          : HttpClientRequest.post(path),
      ),
    put: (path: string, body?: unknown) =>
      exec(
        body !== undefined
          ? HttpClientRequest.put(path).pipe(HttpClientRequest.bodyUnsafeJson(body))
          : HttpClientRequest.put(path),
      ),
    del: (path: string) =>
      exec(HttpClientRequest.del(path)),
  }
}
