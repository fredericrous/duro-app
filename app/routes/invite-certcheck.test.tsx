import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, act, waitFor, cleanup } from "@testing-library/react"
import { Suspense, use } from "react"

function checkCert(healthUrl: string): Promise<boolean> {
  return fetch(healthUrl, { mode: "cors" })
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("CertCheck", () => {
  it("shows success when health endpoint returns 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }))

    const promise = checkCert("https://home.example.com/health")

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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("error", { status: 500 }))

    const promise = checkCert("https://home.example.com/health")

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
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"))

    const promise = checkCert("https://home.example.com/health")

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
