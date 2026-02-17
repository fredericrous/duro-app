import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import { render, screen, act, waitFor, cleanup } from "@testing-library/react"
import { Suspense, use } from "react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"

function checkCert(): Promise<boolean> {
  return fetch("https://home.daddyshome.fr/health", { mode: "cors" })
    .then((r) => r.ok)
    .catch(() => false)
}

function CertCheckLoading() {
  return <p data-testid="cert-loading">Checking certificate...</p>
}

function CertCheckResult({ certPromise }: { certPromise: Promise<boolean> }) {
  const installed = use(certPromise)
  if (installed) {
    return <p data-testid="cert-success">Certificate detected</p>
  }
  return <p data-testid="cert-warning">Certificate not installed</p>
}

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => server.close())

describe("CertCheck with MSW", () => {
  it("shows success when health endpoint returns 200", async () => {
    server.use(
      http.get("https://home.daddyshome.fr/health", () => {
        return HttpResponse.text("ok", { status: 200 })
      }),
    )

    const promise = checkCert()

    await act(async () => {
      render(
        <Suspense fallback={<CertCheckLoading />}>
          <CertCheckResult certPromise={promise} />
        </Suspense>,
      )
      await promise
    })

    await waitFor(() => {
      expect(screen.getByTestId("cert-success")).toBeInTheDocument()
    })
  })

  it("shows warning when health endpoint returns 500", async () => {
    server.use(
      http.get("https://home.daddyshome.fr/health", () => {
        return HttpResponse.text("error", { status: 500 })
      }),
    )

    const promise = checkCert()

    await act(async () => {
      render(
        <Suspense fallback={<CertCheckLoading />}>
          <CertCheckResult certPromise={promise} />
        </Suspense>,
      )
      await promise
    })

    await waitFor(() => {
      expect(screen.getByTestId("cert-warning")).toBeInTheDocument()
    })
  })

  it("shows warning when health endpoint is unreachable", async () => {
    server.use(
      http.get("https://home.daddyshome.fr/health", () => {
        return HttpResponse.error()
      }),
    )

    const promise = checkCert()

    await act(async () => {
      render(
        <Suspense fallback={<CertCheckLoading />}>
          <CertCheckResult certPromise={promise} />
        </Suspense>,
      )
      await promise
    })

    await waitFor(() => {
      expect(screen.getByTestId("cert-warning")).toBeInTheDocument()
    })
  })
})
