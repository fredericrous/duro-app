// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { Effect, ManagedRuntime } from "effect"
import { EmailService, EmailServiceDev } from "./EmailService.server"

// The Live variant uses nodemailer + reads /certs/ca.crt + renders
// React Email templates with i18n — full mockable surface but expensive.
// The Dev variant is what every test that touches the invite/cert flows
// indirectly uses; covering it locks down the contract.

describe("EmailService (Dev)", () => {
  const rt = ManagedRuntime.make(EmailServiceDev)

  it("sendInviteEmail resolves without throwing (logs only in dev)", async () => {
    const debug = vi.spyOn(console, "log").mockImplementation(() => {})
    await rt.runPromise(
      Effect.gen(function* () {
        const e = yield* EmailService
        yield* e.sendInviteEmail("alice@example.com", "tok", "admin", Buffer.from(""), "en")
      }),
    )
    debug.mockRestore()
  })

  it("sendInviteEmail with no locale uses default", async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const e = yield* EmailService
        yield* e.sendInviteEmail("bob@example.com", "tok", "admin", Buffer.from(""))
      }),
    )
  })

  it("sendCertRenewalEmail resolves without throwing", async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const e = yield* EmailService
        yield* e.sendCertRenewalEmail("alice@example.com", Buffer.from(""), "fr")
      }),
    )
  })
})
