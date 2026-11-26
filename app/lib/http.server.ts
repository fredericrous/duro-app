import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import { Effect } from "effect"

class HttpStatusFailure {
  constructor(
    readonly httpStatus: number,
    readonly detail: string,
  ) {}
}

export const makeJsonApi = <E>(
  client: HttpClient.HttpClient,
  baseUrl: string,
  defaultHeaders: Record<string, string>,
  mapError: (cause: unknown, httpStatus?: number) => E,
) => {
  const exec = (req: HttpClientRequest.HttpClientRequest) =>
    client.execute(req.pipe(HttpClientRequest.prependUrl(baseUrl), HttpClientRequest.setHeaders(defaultHeaders))).pipe(
      Effect.flatMap((response) => {
        if (response.status >= 200 && response.status < 300) {
          return response.json.pipe(Effect.mapError((cause): string | HttpStatusFailure => String(cause)))
        }
        return response.text.pipe(
          Effect.catchAll(() => Effect.succeed("")),
          Effect.flatMap((body) =>
            Effect.fail(new HttpStatusFailure(response.status, `${response.status} - ${body.slice(0, 500)}`)),
          ),
        )
      }),
      Effect.mapError((failure) =>
        failure instanceof HttpStatusFailure ? mapError(failure.detail, failure.httpStatus) : mapError(failure),
      ),
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
