import { Context, Effect, Data, Layer } from "effect"
import { readFileSync } from "node:fs"
import nodemailer from "nodemailer"
import type SMTPTransport from "nodemailer/lib/smtp-transport"
import { render } from "@react-email/render"
import { InviteEmail } from "~/lib/emails/invite-email"

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
  }
>() {}

export const EmailServiceLive = Layer.effect(
  EmailService,
  Effect.gen(function* () {
    const host = process.env.SMTP_HOST ?? ""
    const port = parseInt(process.env.SMTP_PORT ?? "587", 10)
    const user = process.env.SMTP_USER ?? ""
    const pass = process.env.SMTP_PASS ?? ""
    const from = process.env.SMTP_FROM ?? "noreply@daddyshome.fr"
    const inviteBaseUrl =
      process.env.INVITE_BASE_URL ?? "https://join.daddyshome.fr"

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

    const transporter = nodemailer.createTransport(transportOptions)

    return {
      sendInviteEmail: (
        email: string,
        token: string,
        invitedBy: string,
        p12Buffer: Buffer,
      ) =>
        Effect.gen(function* () {
          const inviteUrl = `${inviteBaseUrl}/invite/${token}`

          const html = yield* Effect.tryPromise({
            try: () =>
              render(
                InviteEmail({
                  inviteUrl,
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
    }
  }),
)
