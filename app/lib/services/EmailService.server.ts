import { Context, Effect, Data, Layer, Config, Redacted } from "effect"
import { readFileSync } from "node:fs"
import nodemailer from "nodemailer"
import type SMTPTransport from "nodemailer/lib/smtp-transport"
import { render } from "@react-email/render"
import { InviteEmail } from "~/lib/emails/invite-email"
import { CertRenewalEmail } from "~/lib/emails/cert-renewal-email"

export class EmailError extends Data.TaggedError("EmailError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class EmailService extends Context.Tag("EmailService")<
  EmailService,
  {
    readonly sendInviteEmail: (
      email: string,
      token: string,
      invitedBy: string,
      p12Buffer: Buffer,
    ) => Effect.Effect<void, EmailError>
    readonly sendCertRenewalEmail: (
      email: string,
      p12Buffer: Buffer,
    ) => Effect.Effect<void, EmailError>
  }
>() {}

export const EmailServiceLive = Layer.scoped(
  EmailService,
  Effect.gen(function* () {
    const host = yield* Config.string("SMTP_HOST")
    const port = yield* Config.integer("SMTP_PORT").pipe(Config.withDefault(587))
    const user = yield* Config.string("SMTP_USER")
    const pass = Redacted.value(yield* Config.redacted("SMTP_PASS"))
    const from = yield* Config.string("SMTP_FROM").pipe(Config.withDefault("noreply@daddyshome.fr"))
    const inviteBaseUrl = yield* Config.string("INVITE_BASE_URL").pipe(Config.withDefault("https://join.daddyshome.fr"))

    // Load internal CA cert for SMTP TLS verification
    let ca: string | undefined
    try {
      ca = readFileSync("/certs/internal-ca.pem", "utf-8")
    } catch {
      // CA cert not available (dev environment)
    }

    const transportOptions: SMTPTransport.Options = {
      host,
      port,
      secure: false,
      auth: { user, pass },
      tls: ca ? { ca, rejectUnauthorized: true } : undefined,
    }

    const transporter = yield* Effect.acquireRelease(
      Effect.sync(() => nodemailer.createTransport(transportOptions)),
      (t) => Effect.sync(() => t.close()),
    )

    return {
      sendInviteEmail: (
        email: string,
        token: string,
        invitedBy: string,
        p12Buffer: Buffer,
      ) =>
        Effect.gen(function* () {
          const inviteUrl = `${inviteBaseUrl}/invite/${token}`
          const reinviteUrl = `${inviteBaseUrl}/reinvite/${token}`

          const html = yield* Effect.tryPromise({
            try: () =>
              render(
                InviteEmail({
                  inviteUrl,
                  reinviteUrl,
                  invitedBy,
                }),
              ),
            catch: (e) =>
              new EmailError({
                message: "Failed to render email template",
                cause: e,
              }),
          })

          yield* Effect.tryPromise({
            try: () =>
              transporter.sendMail({
                from,
                to: email,
                subject: "You've been invited to Daddyshome",
                html,
                attachments: [
                  {
                    filename: "certificate.p12",
                    content: p12Buffer,
                    contentType: "application/x-pkcs12",
                  },
                ],
              }),
            catch: (e) =>
              new EmailError({
                message: "Failed to send invite email",
                cause: e,
              }),
          })
        }),

      sendCertRenewalEmail: (email: string, p12Buffer: Buffer) =>
        Effect.gen(function* () {
          const html = yield* Effect.tryPromise({
            try: () => render(CertRenewalEmail()),
            catch: (e) =>
              new EmailError({
                message: "Failed to render cert renewal email template",
                cause: e,
              }),
          })

          yield* Effect.tryPromise({
            try: () =>
              transporter.sendMail({
                from,
                to: email,
                subject: "Your Daddyshome certificate has been renewed",
                html,
                attachments: [
                  {
                    filename: "certificate.p12",
                    content: p12Buffer,
                    contentType: "application/x-pkcs12",
                  },
                ],
              }),
            catch: (e) =>
              new EmailError({
                message: "Failed to send cert renewal email",
                cause: e,
              }),
          })
        }),
    }
  }),
)
