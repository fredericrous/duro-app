import { isbot } from "isbot"
import { renderToPipeableStream } from "react-dom/server"
import { ServerRouter } from "react-router"
import { I18nextProvider } from "react-i18next"
import type { EntryContext } from "react-router"
import { PassThrough } from "node:stream"
import { createReadableStreamFromReadable } from "@react-router/node"
import { resolveLocale, createI18nInstance } from "~/lib/i18n.server"

const ABORT_DELAY = 5_000

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  const lng = resolveLocale(request)
  const i18n = await createI18nInstance(lng)
  const callbackName = isbot(request.headers.get("user-agent")) ? "onAllReady" : "onShellReady"

  return new Promise((resolve, reject) => {
    let shellRendered = false

    const { pipe, abort } = renderToPipeableStream(
      <I18nextProvider i18n={i18n}>
        <ServerRouter context={routerContext} url={request.url} />
      </I18nextProvider>,
      {
        [callbackName]() {
          shellRendered = true
          const body = new PassThrough()
          const stream = createReadableStreamFromReadable(body)

          responseHeaders.set("Content-Type", "text/html")
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          )
          pipe(body)
        },
        onShellError(error: unknown) {
          reject(error)
        },
        onError(error: unknown) {
          responseStatusCode = 500
          if (shellRendered) {
            console.error(error)
          }
        },
      },
    )

    setTimeout(abort, ABORT_DELAY)
  })
}
