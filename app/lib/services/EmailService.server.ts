import { Context, Effect, Data, Layer, Config, Redacted } from "effect"
import { readFileSync } from "node:fs"
import * as crypto from "node:crypto"
import nodemailer from "nodemailer"
import type SMTPTransport from "nodemailer/lib/smtp-transport"
import { render } from "@react-email/render"
import { InviteEmail } from "~/lib/emails/invite-email"
import { CertRenewalEmail } from "~/lib/emails/cert-renewal-email"
import { config } from "~/lib/config.server"
import { createI18nInstance } from "~/lib/i18n.server"

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
      locale?: string,
      openToken?: string,
      inviteId?: string,
    ) => Effect.Effect<string, EmailError>
    readonly sendCertRenewalEmail: (
      email: string,
      locale?: string,
      revealToken?: string,
    ) => Effect.Effect<void, EmailError>
    /** Plain notification to an admin that a device-recovery request is pending. */
    readonly sendRecoveryNotificationEmail: (
      adminEmail: string,
      requesterEmail: string,
      note: string | null,
    ) => Effect.Effect<void, EmailError>
    /**
     * Generic transactional notification (heading + body + optional CTA link).
     * Used for access-invitation and access-request updates. `cta.url` must be
     * a trusted internal URL — it is not escaped.
     */
    readonly sendNotificationEmail: (
      to: string,
      subject: string,
      heading: string,
      body: string,
      cta?: { text: string; url: string },
    ) => Effect.Effect<void, EmailError>
  }
>() {}

/** Escape the three HTML-significant chars for safe interpolation into markup. */
export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export const EmailServiceDev = Layer.succeed(EmailService, {
  sendInviteEmail: (email, _token, _invitedBy, locale, _openToken, inviteId) =>
    Effect.log(`[DEV] Would send invite email to ${email} (locale=${locale ?? "en"})`).pipe(
      Effect.as(`<invite-${inviteId ?? "dev"}@${config.allowedOriginSuffix}>`),
    ),
  sendCertRenewalEmail: (email, locale, _revealToken) =>
    Effect.log(`[DEV] Would send cert renewal email to ${email} (locale=${locale ?? "en"})`),
  sendRecoveryNotificationEmail: (adminEmail, requesterEmail) =>
    Effect.log(`[DEV] Would notify admin ${adminEmail} of recovery request for ${requesterEmail}`),
  sendNotificationEmail: (to, subject) => Effect.log(`[DEV] Would send notification email to ${to}: ${subject}`),
})

export const EmailServiceLive = Layer.scoped(
  EmailService,
  Effect.gen(function* () {
    const host = yield* Config.string("SMTP_HOST")
    const port = yield* Config.integer("SMTP_PORT").pipe(Config.withDefault(587))
    const user = yield* Config.string("SMTP_USER")
    const pass = Redacted.value(yield* Config.redacted("SMTP_PASS"))
    const from = yield* Config.string("SMTP_FROM").pipe(Config.withDefault(`noreply@${config.allowedOriginSuffix}`))

    // Load internal CA cert for SMTP TLS verification
    let ca: string | undefined
    try {
      ca = readFileSync("/certs/ca.crt", "utf-8")
    } catch {
      // CA cert not available (dev environment)
    }

    const transportOptions: SMTPTransport.Options = {
      host,
      port,
      secure: port === 465,
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
        locale?: string,
        openToken?: string,
        inviteId?: string,
      ) =>
        Effect.gen(function* () {
          const lng = locale ?? "en"
          // Deterministic Message-ID so the delivery webhook can correlate the
          // Stalwart delivery/bounce event straight back to this invite.
          const messageId = `<invite-${inviteId ?? crypto.randomUUID()}@${config.allowedOriginSuffix}>`
          const i18n = yield* Effect.tryPromise({
            try: () => createI18nInstance(lng),
            catch: (e) => new EmailError({ message: "Failed to create i18n instance", cause: e }),
          })
          const t = i18n.getFixedT(lng)

          const inviteUrl = `${config.inviteBaseUrl}/invite/${token}`
          const reinviteUrl = `${config.inviteBaseUrl}/reinvite/${token}`
          // CTA click-tracking redirector → records the click, then 302s to
          // inviteUrl. A click is a human action, so a stronger signal than the
          // open pixel (which proxies pre-fetch on delivery).
          const clickUrl = `${config.inviteBaseUrl}/c/${token}`
          // Open-tracking pixel — served from the mTLS-free join host so mail
          // clients can fetch it. Omitted when no openToken (older invites).
          const pixelUrl = openToken ? `${config.inviteBaseUrl}/e/${openToken}` : undefined

          const html = yield* Effect.tryPromise({
            try: () =>
              render(
                InviteEmail({
                  inviteUrl,
                  reinviteUrl,
                  invitedBy,
                  appName: config.appName,
                  appDescription: config.appDescription,
                  clickUrl,
                  pixelUrl,
                  t,
                }),
              ),
            catch: (e) =>
              new EmailError({
                message: `Failed to render email template: ${e instanceof Error ? e.message : String(e)}`,
                cause: e,
              }),
          })

          yield* Effect.tryPromise({
            try: () =>
              // Link-only: no P12 attachment. A binary .p12 attachment trips
              // Gmail's phishing heuristics (and SES relays the file's spam
              // signal too). The cert is downloaded from the /invite page,
              // behind the same token — same split as the renewal email.
              transporter.sendMail({
                from,
                to: email,
                messageId,
                subject: t("email.invite.subject", { appName: config.appName }),
                html,
              }),
            catch: (e) =>
              new EmailError({
                message: "Failed to send invite email",
                cause: e,
              }),
          })

          return messageId
        }),

      // Link-only: no P12 attachment. A message carrying both an external link
      // and a binary .p12 attachment trips Gmail's phishing heuristics (and got
      // hard-rejected in the field). The cert is downloaded from the reveal
      // page instead, behind the same token.
      sendCertRenewalEmail: (email: string, locale?: string, revealToken?: string) =>
        Effect.gen(function* () {
          const lng = locale ?? "en"
          const i18n = yield* Effect.tryPromise({
            try: () => createI18nInstance(lng),
            catch: (e) => new EmailError({ message: "Failed to create i18n instance", cause: e }),
          })
          const t = i18n.getFixedT(lng)

          const revealUrl = revealToken ? `${config.inviteBaseUrl}/cert/${revealToken}` : undefined

          const html = yield* Effect.tryPromise({
            try: () => render(CertRenewalEmail({ appName: config.appName, t, revealUrl })),
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
                subject: t("email.renewal.subject", { appName: config.appName }),
                html,
              }),
            catch: (e) =>
              new EmailError({
                message: "Failed to send cert renewal email",
                cause: e,
              }),
          })
        }),

      // Plain internal notification to an admin — no secret, no recipient-facing
      // content. The actual review happens in the admin panel.
      sendRecoveryNotificationEmail: (adminEmail: string, requesterEmail: string, note: string | null) =>
        Effect.tryPromise({
          try: () =>
            transporter.sendMail({
              from,
              to: adminEmail,
              subject: `[${config.appName}] Device recovery request from ${requesterEmail}`,
              html:
                `<p>A device-recovery request is pending review.</p>` +
                `<p><strong>From:</strong> ${requesterEmail}</p>` +
                (note ? `<p><strong>Note:</strong> ${note.replace(/[<>&]/g, "")}</p>` : "") +
                `<p>Approve or deny it in the admin panel: ` +
                `<a href="${config.homeUrl}/admin/recovery">${config.homeUrl}/admin/recovery</a></p>`,
            }),
          catch: (e) => new EmailError({ message: "Failed to send recovery notification", cause: e }),
        }).pipe(Effect.asVoid),

      sendNotificationEmail: (
        to: string,
        subject: string,
        heading: string,
        body: string,
        cta?: { text: string; url: string },
      ) =>
        Effect.tryPromise({
          try: () =>
            transporter.sendMail({
              from,
              to,
              subject,
              html:
                `<h2>${escapeHtml(heading)}</h2>` +
                `<p>${escapeHtml(body)}</p>` +
                (cta ? `<p><a href="${cta.url}">${escapeHtml(cta.text)}</a></p>` : ""),
            }),
          catch: (e) => new EmailError({ message: "Failed to send notification email", cause: e }),
        }).pipe(Effect.asVoid),
    }
  }),
)
