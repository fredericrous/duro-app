import { describe, it, expect, afterEach, vi, beforeEach } from "vitest"
import { render, screen, waitFor, cleanup, act } from "@testing-library/react"

vi.mock("react-router", () => ({
  redirect: vi.fn(),
  useParams: () => ({ token: "test-token" }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      const map: Record<string, string> = {
        "invite.title": `Welcome to ${opts?.appName ?? ""}`,
        "invite.subtitle": `You've been invited as <strong>${opts?.email ?? ""}</strong>`,
        "invite.groupsLabel": `Groups: ${opts?.groups ?? ""}`,
        "invite.password.title": "Your Certificate Password",
        "invite.password.warning": "Scratch to reveal — save it now!",
        "invite.password.consumed": "Password already revealed.",
        "invite.password.copy": "Copy",
        "invite.password.copied": "Copied!",
        "invite.password.oneTime": "This password is shown only once.",
        "invite.cert.checking": "Checking certificate...",
        "invite.cert.detected": "Certificate detected",
        "invite.cert.notInstalled": "Certificate not installed",
        "invite.cert.hint": "Install the certificate first",
        "invite.cert.retry": "Retry",
        "invite.cert.continue": "Continue",
        "invite.expired.title": "Invite Expired",
        "invite.expired.message": "This invite has expired.",
        "invite.used.title": "Already Used",
        "invite.used.message": "This invite was already used.",
        "invite.error.title": "Error",
      }
      return map[key] ?? key
    },
  }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// Dynamic import so vi.mock is applied first
const { default: InvitePage } = await import("./invite")

describe("InvitePage", () => {
  beforeEach(() => {
    // Default: cert check fails (no certificate installed)
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"))
  })

  it("renders valid invite with password and cert check", async () => {
    const loaderData = {
      valid: true as const,
      email: "user@example.com",
      groupNames: ["family", "media"],
      p12Password: "s3cret-pass",
      appName: "TestApp",
      healthUrl: "https://home.example.com/health",
    }

    await act(async () => {
      render(<InvitePage loaderData={loaderData} actionData={undefined} />)
    })

    // Title
    expect(screen.getByText("Welcome to TestApp")).toBeInTheDocument()

    // Email in subtitle (rendered as dangerouslySetInnerHTML)
    const subtitle = document.querySelector(".subtitle")
    expect(subtitle).toBeInTheDocument()
    expect(subtitle?.innerHTML).toContain("user@example.com")

    // Groups
    expect(screen.getByText("Groups: family, media")).toBeInTheDocument()

    // Password section
    expect(screen.getByText("Your Certificate Password")).toBeInTheDocument()
    expect(screen.getByDisplayValue("s3cret-pass")).toBeInTheDocument()

    // Cert check resolves to warning (fetch rejected) — wait for "Retry" button
    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument()
    })
  })

  it("renders expired invite error", () => {
    const loaderData = {
      valid: false as const,
      error: "expired",
      appName: "TestApp",
      healthUrl: "https://home.example.com/health",
    }

    render(<InvitePage loaderData={loaderData} actionData={undefined} />)

    expect(screen.getByText("Invite Expired")).toBeInTheDocument()
  })

  it("renders already-used invite error", () => {
    const loaderData = {
      valid: false as const,
      error: "already_used",
      appName: "TestApp",
      healthUrl: "https://home.example.com/health",
    }

    render(<InvitePage loaderData={loaderData} actionData={undefined} />)

    expect(screen.getByText("Already Used")).toBeInTheDocument()
  })

  it("renders generic error", () => {
    const loaderData = {
      valid: false as const,
      error: "Invalid invite link",
      appName: "TestApp",
      healthUrl: "https://home.example.com/health",
    }

    render(<InvitePage loaderData={loaderData} actionData={undefined} />)

    expect(screen.getByText("Error")).toBeInTheDocument()
    expect(screen.getByText("Invalid invite link")).toBeInTheDocument()
  })

  it("shows cert detected when health check succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }))

    const loaderData = {
      valid: true as const,
      email: "user@example.com",
      groupNames: [],
      p12Password: "abc",
      appName: "TestApp",
      healthUrl: "https://home.example.com/health",
    }

    await act(async () => {
      render(<InvitePage loaderData={loaderData} actionData={undefined} />)
    })

    await waitFor(() => {
      expect(screen.getByText("Certificate detected")).toBeInTheDocument()
    })

    // Continue link should be present and clickable
    const continueLink = screen.getByText("Continue")
    expect(continueLink.closest("a")).toHaveAttribute("href", "/invite/test-token/create-account")
  })

  it("shows consumed password message when p12Password is null", async () => {
    const loaderData = {
      valid: true as const,
      email: "user@example.com",
      groupNames: [],
      p12Password: null,
      appName: "TestApp",
      healthUrl: "https://home.example.com/health",
    }

    await act(async () => {
      render(<InvitePage loaderData={loaderData} actionData={undefined} />)
    })

    expect(screen.getByText("Password already revealed.")).toBeInTheDocument()
  })

  it("displays action error from actionData", async () => {
    const loaderData = {
      valid: true as const,
      email: "user@example.com",
      groupNames: [],
      p12Password: "abc",
      appName: "TestApp",
      healthUrl: "https://home.example.com/health",
    }

    await act(async () => {
      render(<InvitePage loaderData={loaderData} actionData={{ error: "Something went wrong" }} />)
    })

    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
  })

  it("disables continue button when cert not installed", async () => {
    const loaderData = {
      valid: true as const,
      email: "user@example.com",
      groupNames: [],
      p12Password: "abc",
      appName: "TestApp",
      healthUrl: "https://home.example.com/health",
    }

    await act(async () => {
      render(<InvitePage loaderData={loaderData} actionData={undefined} />)
    })

    // Wait for cert check to resolve (button label changes from "Checking..." to "Retry")
    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument()
    })

    const continueBtn = screen.getByText("Continue")
    expect(continueBtn.closest("button")).toBeDisabled()
  })
})
