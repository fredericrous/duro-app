import { useState } from "react"
import type { Route } from "./+types/admin.settings"
import { runEffect } from "~/lib/runtime.server"
import { GitHubClient } from "~/lib/services/GitHubClient.server"
import { Effect } from "effect"
import styles from "./admin.settings.module.css"

export async function loader() {
  const webhookSecret = process.env.WEBHOOK_SECRET ?? ""
  const hasWebhookSecret = webhookSecret.length > 0

  let githubSecretConfigured = false
  if (hasWebhookSecret) {
    try {
      githubSecretConfigured = await runEffect(
        Effect.gen(function* () {
          const github = yield* GitHubClient
          return yield* github.checkWebhookSecret()
        }),
      )
    } catch {}
  }

  return { webhookSecret: hasWebhookSecret ? webhookSecret : null, githubSecretConfigured }
}

const WORKFLOW_SNIPPET = `name: Notify Cert Merged
on:
  push:
    branches: [main]
    paths:
      - 'kubernetes/nas/platform-foundation/vault/client-certs/certificates/*.yaml'

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Extract invite ID from commit message
        id: extract
        run: |
          MSG="\${{ github.event.head_commit.message }}"
          PR_NUM=$(echo "$MSG" | grep -oP '#\\K\\d+' | head -1)
          if [ -z "$PR_NUM" ]; then
            echo "skip=true" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          BRANCH=$(gh pr view "$PR_NUM" --json headRefName -q '.headRefName' 2>/dev/null || true)
          INVITE_ID=$(echo "$BRANCH" | grep -oP 'cert/invite-\\K.*' || true)
          if [ -z "$INVITE_ID" ]; then
            echo "skip=true" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          echo "invite_id=$INVITE_ID" >> "$GITHUB_OUTPUT"
          echo "skip=false" >> "$GITHUB_OUTPUT"
        env:
          GH_TOKEN: \${{ github.token }}

      - name: Notify duro
        if: steps.extract.outputs.skip != 'true'
        run: |
          curl -sf -X POST \\
            -H "Authorization: Bearer \${{ secrets.DURO_WEBHOOK_SECRET }}" \\
            -H "Content-Type: application/json" \\
            -d '{"inviteId":"\${{ steps.extract.outputs.invite_id }}"}' \\
            https://join.daddyshome.fr/api/invite-merged \\
            || echo "::warning::Webhook delivery failed, reconciler will handle it"`

export default function AdminSettingsPage({ loaderData }: Route.ComponentProps) {
  const { webhookSecret, githubSecretConfigured } = loaderData

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>Webhook Configuration</h2>
      <p className={styles.description}>
        When a cert PR merges, a GitHub Action can POST to Duro for instant email delivery
        instead of waiting for the 2-minute reconciler poll.
      </p>

      {!webhookSecret && (
        <div className={styles.statusCard}>
          <div className={`${styles.statusIcon} ${styles.statusWarning}`}>!</div>
          <div>
            <p className={styles.statusText}>Webhook secret not configured</p>
            <p className={styles.statusHint}>
              Waiting for ExternalSecret to generate and sync the <code>WEBHOOK_SECRET</code> env var.
              Check that the <code>webhook-secret-generator.yaml</code> resources are deployed.
            </p>
          </div>
        </div>
      )}

      {webhookSecret && !githubSecretConfigured && (
        <div>
          <div className={`${styles.statusCard} ${styles.statusCardSetup}`}>
            <div className={`${styles.statusIcon} ${styles.statusInfo}`}>i</div>
            <div>
              <p className={styles.statusText}>GitHub secret not configured yet</p>
              <p className={styles.statusHint}>
                Copy the webhook secret below and add it as <code>DURO_WEBHOOK_SECRET</code> in
                GitHub repo Settings &rarr; Secrets and variables &rarr; Actions.
              </p>
            </div>
          </div>

          <CopySecret secret={webhookSecret} />

          <details className={styles.accordion}>
            <summary className={styles.accordionSummary}>
              GitHub Actions workflow snippet
            </summary>
            <pre className={styles.codeBlock}>{WORKFLOW_SNIPPET}</pre>
          </details>
        </div>
      )}

      {webhookSecret && githubSecretConfigured && (
        <div className={styles.statusCard}>
          <div className={`${styles.statusIcon} ${styles.statusOk}`}>&#10003;</div>
          <div>
            <p className={styles.statusText}>Webhook configured</p>
            <p className={styles.statusHint}>
              Cert PR merges trigger instant email delivery via the GitHub Action.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

function CopySecret({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(secret).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className={styles.secretRow}>
      <code className={styles.secretValue}>{secret}</code>
      <button onClick={handleCopy} className={styles.copyBtn}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  )
}
