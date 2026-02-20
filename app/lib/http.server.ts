import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import { Effect } from "effect"

export const makeJsonApi = <E>(
  client: HttpClient.HttpClient,
  baseUrl: string,
  defaultHeaders: Record<string, string>,
  mapError: (cause: unknown) => E,
) => {
  const exec = (req: HttpClientRequest.HttpClientRequest) =>
    client.execute(req.pipe(HttpClientRequest.prependUrl(baseUrl), HttpClientRequest.setHeaders(defaultHeaders))).pipe(
      Effect.flatMap((response) => {
        if (response.status >= 200 && response.status < 300) {
          return response.json.pipe(Effect.mapError(String))
        }
        return response.text.pipe(
          Effect.catchAll(() => Effect.succeed("")),
          Effect.flatMap((body) => Effect.fail(`${response.status} - ${body.slice(0, 500)}`)),
        )
      }),
      Effect.mapError(mapError),
      Effect.scoped,
    )

  return {
    get: (path: string) => exec(HttpClientRequest.get(path)),
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
    patch: (path: string, body?: unknown) =>
      exec(
        body !== undefined
          ? HttpClientRequest.patch(path).pipe(HttpClientRequest.bodyUnsafeJson(body))
          : HttpClientRequest.patch(path),
      ),
    del: (path: string) => exec(HttpClientRequest.del(path)),
  }
}
