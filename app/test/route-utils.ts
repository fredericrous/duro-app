/**
 * Shared helpers for testing React Router v7 route `loader` and `action`
 * exports as plain functions.
 *
 * React Router 7 generates loader/action signatures via codegen
 * (`./+types/route` modules) with field shapes the runtime ignores. Tests
 * just need a minimal `{ request, params, context }` envelope; the helpers
 * here build it and surface thrown `Response` redirects via the return value
 * instead of bubbling them up as exceptions.
 *
 * Pattern proven in `app/routes/admin.setup.test.tsx`.
 */

export interface CallLoaderInput {
  /** Full URL passed to the Request constructor (defaults to "http://localhost/"). */
  url?: string
  /** Path params (`useParams()` shape). */
  params?: Record<string, string>
  /** Arbitrary context object — most routes don't read it. */
  context?: Record<string, unknown>
  /** Pre-built Request — overrides `url`/`headers` when set. */
  request?: Request
  /** Extra request headers (e.g. cookies). */
  headers?: HeadersInit
}

export interface CallActionInput extends CallLoaderInput {
  /**
   * Form data submitted by the action. When set, the helper builds a POST
   * Request with the encoded body.
   */
  formData?: FormData | Record<string, string>
}

/**
 * Result of `callLoader` / `callAction`. Either the loader resolved with a
 * value (`.data`) or it threw a `Response` (redirect / 4xx — `.response`).
 * Tests can branch on whichever shape they expect without `try`/`catch`.
 */
export type LoaderResult<T> = { kind: "data"; data: T } | { kind: "response"; response: Response }

type LoaderLike = (args: { request: Request; params: object; context: object }) => unknown
type ActionLike = LoaderLike

function buildRequest(input: CallLoaderInput): Request {
  if (input.request) return input.request
  return new Request(input.url ?? "http://localhost/", { headers: input.headers })
}

function buildActionRequest(input: CallActionInput): Request {
  if (input.request) return input.request
  let body: FormData | undefined
  if (input.formData) {
    if (input.formData instanceof FormData) {
      body = input.formData
    } else {
      body = new FormData()
      for (const [k, v] of Object.entries(input.formData)) body.append(k, v)
    }
  }
  return new Request(input.url ?? "http://localhost/", {
    method: "POST",
    body,
    headers: input.headers,
  })
}

async function invoke<T>(fn: LoaderLike, request: Request, input: CallLoaderInput): Promise<LoaderResult<T>> {
  try {
    const data = (await fn({
      request,
      params: input.params ?? {},
      context: input.context ?? {},
    })) as T
    return { kind: "data", data }
  } catch (thrown) {
    if (thrown instanceof Response) return { kind: "response", response: thrown }
    throw thrown
  }
}

/**
 * Call a route's `loader` export. Returns either the resolved data (when the
 * loader returned normally) or the thrown `Response` (when the loader
 * short-circuited with a redirect / Response.json — common in auth-gated
 * routes).
 *
 * Cast the loader through `unknown` because React Router's generated type
 * adds harness fields tests don't need to satisfy.
 */
export async function callLoader<T = unknown>(loader: unknown, input: CallLoaderInput = {}): Promise<LoaderResult<T>> {
  return invoke<T>(loader as LoaderLike, buildRequest(input), input)
}

/**
 * Call a route's `action` export. Accepts `formData` either as a `FormData`
 * instance or a plain `Record<string, string>` (helper builds the FormData).
 */
export async function callAction<T = unknown>(action: unknown, input: CallActionInput = {}): Promise<LoaderResult<T>> {
  return invoke<T>(action as ActionLike, buildActionRequest(input), input)
}

/**
 * Convenience: assert the loader returned data and return it. Throws if the
 * loader threw a Response (use this when the test expects a successful load).
 *
 * The generic is intentionally decoupled from the input — many callers pass an
 * untyped `LoaderResult<unknown>` (from `callLoader(loader)` without an
 * explicit type arg) and then narrow at the assertion site via
 * `expectData<MyType>(result)`. Coupling them caused the helper to demand the
 * caller round-trip the type through callLoader, which is just noise.
 */
export function expectData<T = unknown>(result: LoaderResult<unknown>): T {
  if (result.kind !== "data") {
    throw new Error(`expected loader to return data, got Response ${result.response.status}`)
  }
  return result.data as T
}

/**
 * Convenience: assert the loader threw a Response and return it.
 */
export function expectResponse(result: LoaderResult<unknown>): Response {
  if (result.kind !== "response") {
    throw new Error("expected loader to throw a Response, got data")
  }
  return result.response
}
