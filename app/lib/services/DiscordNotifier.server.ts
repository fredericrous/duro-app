import { Context, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest } from "@effect/platform"
import { config } from "~/lib/config.server"

/**
 * Fire-and-forget Discord notifications via an incoming webhook
 * (config.discordWebhookUrl, sourced from the shared Alertmanager webhook).
 *
 * `notify` never fails — a missing webhook or a failed POST is logged and
 * swallowed, so notification problems can't break the calling workflow.
 */
export class DiscordNotifier extends Context.Tag("DiscordNotifier")<
  DiscordNotifier,
  {
    readonly notify: (content: string) => Effect.Effect<void, never>
  }
>() {}

export const DiscordNotifierLive = Layer.effect(
  DiscordNotifier,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return {
      notify: (content: string) =>
        config.discordWebhookUrl
          ? client
              .execute(
                HttpClientRequest.post(config.discordWebhookUrl).pipe(HttpClientRequest.bodyUnsafeJson({ content })),
              )
              .pipe(
                Effect.asVoid,
                Effect.timeout("5 seconds"),
                Effect.catchAll((e) => Effect.logWarning("discord notify failed", { error: String(e) })),
              )
          : Effect.logDebug("discord notify skipped (no webhook configured)"),
    }
  }),
)

export const DiscordNotifierDev = Layer.succeed(DiscordNotifier, {
  notify: (content: string) => Effect.log(`[DEV] Discord: ${content}`),
})
