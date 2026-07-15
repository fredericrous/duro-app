import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import { css, html } from "react-strict-dom"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import { colors } from "@duro-app/tokens/tokens/colors.css"
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
  Heading,
  Inline,
  Input,
  Select,
  Stack,
  Tag,
  Text,
} from "@duro-app/ui"
import type { ApiKey } from "~/lib/governance/types"
import {
  ALLOWED_EXPIRY_DAYS,
  KNOWN_SCOPES,
  WILDCARD_SCOPE,
  type SettingsApiKeysResult,
} from "~/lib/mutations/settings-api-keys"

interface RevealData {
  rawKey: string
  keyPreview: string
  name: string
  scopes: string[]
  expiresInDays: number
}

interface Props {
  apiKeys: ApiKey[]
}

const styles = css.create({
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
  firstRow: {
    borderTopWidth: 0,
  },
  rowDimmed: {
    opacity: 0.55,
  },
  keyBlock: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 13,
    wordBreak: "break-all",
    padding: spacing.sm,
    borderRadius: 6,
    backgroundColor: colors.bgCard,
    color: colors.text,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
  },
})

function formatDate(iso: string | null) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
  } catch {
    return iso
  }
}

type KeyStatus = "active" | "revoked" | "expired"
function statusOf(key: ApiKey): KeyStatus {
  if (key.revokedAt) return "revoked"
  if (key.expiresAt && new Date(key.expiresAt).getTime() < Date.now()) return "expired"
  return "active"
}

function statusBadgeVariant(status: KeyStatus): "success" | "default" | "warning" {
  if (status === "active") return "success"
  if (status === "expired") return "warning"
  return "default"
}

export function ApiKeysSection({ apiKeys }: Props) {
  const { t } = useTranslation()
  const fetcher = useFetcher<{ apiKeys?: SettingsApiKeysResult }>({ key: "api-keys" })
  const result = fetcher.data as SettingsApiKeysResult | undefined

  // ---------- Create form state ----------
  const [name, setName] = useState("")
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(
    () => new Set(KNOWN_SCOPES.filter((s) => s.recommended).map((s) => s.id)),
  )
  const [expiresInDays, setExpiresInDays] = useState<string>("90")
  const [allowWildcard, setAllowWildcard] = useState(false)

  const toggleScope = useCallback((id: string, checked: boolean) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  // ---------- Reveal dialog (owned locally) ----------
  const [reveal, setReveal] = useState<RevealData | null>(null)
  const [savedAck, setSavedAck] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handledKeyIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (result && "apiKeyCreated" in result && result.apiKeyCreated && handledKeyIdRef.current !== result.id) {
      handledKeyIdRef.current = result.id
      setReveal({
        rawKey: result.rawKey,
        keyPreview: result.keyPreview,
        name: result.name,
        scopes: result.scopes,
        expiresInDays: result.expiresInDays,
      })
      setSavedAck(false)
      setCopied(false)
      // Reset the form so submitting again doesn't reuse stale name.
      setName("")
      setSelectedScopes(new Set(KNOWN_SCOPES.filter((s) => s.recommended).map((s) => s.id)))
      setExpiresInDays("90")
      setAllowWildcard(false)
    }
  }, [result])

  const closeReveal = useCallback(() => {
    setReveal(null)
    setSavedAck(false)
    setCopied(false)
  }, [])

  const handleCopy = useCallback(async () => {
    if (!reveal) return
    try {
      await navigator.clipboard.writeText(reveal.rawKey)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard may be blocked under non-secure-context or Permissions-
      // Policy. The textarea below is the user-visible fallback.
      setCopied(false)
    }
  }, [reveal])

  // ---------- Revoke confirm dialog ----------
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null)

  // ---------- Render helpers ----------
  const submitting = fetcher.state !== "idle"
  const errorMessage = result && "apiKeyError" in result ? result.apiKeyError : null

  const sortedKeys = useMemo(
    () => [...apiKeys].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [apiKeys],
  )

  return (
    <Stack gap="lg">
      {errorMessage && <Alert variant="error">{errorMessage}</Alert>}

      {sortedKeys.length === 0 ? (
        <Text as="p" color="muted">
          {t("settings.apiKeys.empty")}
        </Text>
      ) : (
        <html.div>
          {sortedKeys.map((key, idx) => {
            const status = statusOf(key)
            const scopes = Array.isArray(key.scopes) ? (key.scopes as string[]) : []
            const isWildcard = scopes.includes(WILDCARD_SCOPE)
            return (
              <html.div
                key={key.id}
                style={[styles.row, idx === 0 && styles.firstRow, status !== "active" && styles.rowDimmed]}
              >
                <Stack gap="xs">
                  <Inline gap="sm" align="center">
                    <Text as="span" weight="semibold">
                      {key.name}
                    </Text>
                    <Badge variant={statusBadgeVariant(status)} size="sm">
                      {t(`settings.apiKeys.status.${status}`)}
                    </Badge>
                  </Inline>
                  <Text as="span" variant="bodySm" color="muted">
                    {key.keyPreview ?? "—"} · {t("settings.apiKeys.created", { date: formatDate(key.createdAt) })}
                    {key.expiresAt && (
                      <>
                        {" · "}
                        {t("settings.apiKeys.expires", { date: formatDate(key.expiresAt) })}
                      </>
                    )}
                    {key.revokedAt && (
                      <>
                        {" · "}
                        {t("settings.apiKeys.revokedOn", { date: formatDate(key.revokedAt) })}
                      </>
                    )}
                  </Text>
                  <Inline gap="xs">
                    {isWildcard ? (
                      <Tag value={WILDCARD_SCOPE} variant="warning" size="sm">
                        {t("settings.apiKeys.scopes.wildcardChip")}
                      </Tag>
                    ) : (
                      scopes.map((scope) => (
                        <Tag key={scope} value={scope} size="sm">
                          {KNOWN_SCOPES.find((s) => s.id === scope)?.label ?? scope}
                        </Tag>
                      ))
                    )}
                  </Inline>
                </Stack>
                {status === "active" && (
                  <Button variant="secondary" size="small" onClick={() => setRevokeTarget(key)}>
                    {t("settings.apiKeys.revoke")}
                  </Button>
                )}
              </html.div>
            )
          })}
        </html.div>
      )}

      <html.div>
        <Heading level={3} variant="headingSm">
          {t("settings.apiKeys.create.heading")}
        </Heading>
        <Text as="p" color="muted" variant="bodySm">
          {t("settings.apiKeys.create.description")}
        </Text>
      </html.div>

      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="createApiKey" />
        <Stack gap="lg">
          <Field.Root>
            <Field.Label>{t("settings.apiKeys.fields.name")}</Field.Label>
            <Input
              name="name"
              value={name}
              onChange={(e) => setName((e.target as HTMLInputElement).value)}
              placeholder={t("settings.apiKeys.fields.namePlaceholder")}
              required
            />
            <Field.Description>{t("settings.apiKeys.fields.nameHint")}</Field.Description>
          </Field.Root>

          <Field.Root>
            <Field.Label>{t("settings.apiKeys.fields.scopes")}</Field.Label>
            <Stack gap="sm">
              {KNOWN_SCOPES.map((scope) => (
                <Checkbox
                  key={scope.id}
                  name="scopes"
                  value={scope.id}
                  checked={selectedScopes.has(scope.id)}
                  disabled={allowWildcard}
                  onChange={(e) => toggleScope(scope.id, e.target.checked)}
                >
                  <Stack gap="xs">
                    <Text as="span" weight="medium">
                      {scope.label}
                      {scope.recommended && (
                        <>
                          {" "}
                          <Badge variant="info" size="sm">
                            {t("settings.apiKeys.fields.recommended")}
                          </Badge>
                        </>
                      )}
                    </Text>
                    <Text as="span" variant="bodySm" color="muted">
                      {scope.description}
                    </Text>
                  </Stack>
                </Checkbox>
              ))}
            </Stack>
            <Field.Description>{t("settings.apiKeys.fields.scopesHint")}</Field.Description>
          </Field.Root>

          <Field.Root>
            <Field.Label>{t("settings.apiKeys.fields.expiry")}</Field.Label>
            <Select.Root name="expiresInDays" value={expiresInDays} onValueChange={(v) => v && setExpiresInDays(v)}>
              <Select.Trigger aria-label={t("settings.apiKeys.fields.expiry")}>
                <Select.Value />
                <Select.Icon />
              </Select.Trigger>
              <Select.Popup>
                {ALLOWED_EXPIRY_DAYS.map((days) => (
                  <Select.Item key={days} value={String(days)}>
                    <Select.ItemText>{t("settings.apiKeys.fields.expiryOption", { count: days })}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Root>
            <Field.Description>{t("settings.apiKeys.fields.expiryHint")}</Field.Description>
          </Field.Root>

          <Alert variant="warning">
            <Stack gap="xs">
              <Checkbox
                name="allowWildcard"
                value="true"
                checked={allowWildcard}
                onChange={(e) => setAllowWildcard(e.target.checked)}
              >
                <Text as="span" weight="medium">
                  {t("settings.apiKeys.fields.wildcardLabel")}
                </Text>
              </Checkbox>
              <Text as="span" variant="bodySm" color="muted">
                {t("settings.apiKeys.fields.wildcardWarning")}
              </Text>
            </Stack>
          </Alert>

          <Inline gap="sm">
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || (!allowWildcard && selectedScopes.size === 0) || name.trim().length === 0}
            >
              {submitting ? t("settings.apiKeys.create.submitting") : t("settings.apiKeys.create.submit")}
            </Button>
          </Inline>
        </Stack>
      </fetcher.Form>

      {/* Reveal dialog */}
      <Dialog.Root
        open={reveal !== null}
        onOpenChange={(open) => {
          // Block backdrop/Esc dismiss; only the explicit Done button closes
          // this dialog. A misclick must not destroy the raw key.
          if (!open && savedAck) closeReveal()
        }}
        dismissable={false}
      >
        <Dialog.Portal size="md">
          <Dialog.Header>
            <Dialog.Title>{t("settings.apiKeys.reveal.title", { name: reveal?.name ?? "" })}</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Stack gap="md">
              <Alert variant="warning">{t("settings.apiKeys.reveal.warning")}</Alert>
              <Stack gap="xs">
                <Text as="span" variant="bodySm" color="muted">
                  {t("settings.apiKeys.reveal.rawKeyLabel")}
                </Text>
                <html.div style={styles.keyBlock}>{reveal?.rawKey ?? ""}</html.div>
              </Stack>
              <Stack gap="xs">
                <Text as="span" variant="bodySm" color="muted">
                  {t("settings.apiKeys.reveal.fallbackLabel")}
                </Text>
                <textarea
                  readOnly
                  value={reveal?.rawKey ?? ""}
                  onClick={(e) => e.currentTarget.select()}
                  rows={3}
                  style={{
                    width: "100%",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    fontSize: 12,
                    padding: 8,
                    borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                    backgroundColor: colors.bgCard,
                    color: colors.text,
                    resize: "vertical",
                    minHeight: 64,
                  }}
                />
              </Stack>
              <Checkbox checked={savedAck} onChange={(e) => setSavedAck(e.target.checked)}>
                {t("settings.apiKeys.reveal.ackSaved")}
              </Checkbox>
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            <Inline gap="sm">
              <Button variant="secondary" onClick={handleCopy}>
                {copied ? t("settings.apiKeys.reveal.copied") : t("settings.apiKeys.reveal.copy")}
              </Button>
              <Button variant="primary" disabled={!savedAck} onClick={closeReveal}>
                {t("settings.apiKeys.reveal.done")}
              </Button>
            </Inline>
          </Dialog.Footer>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Revoke confirm dialog */}
      <Dialog.Root open={revokeTarget !== null} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <Dialog.Portal size="sm">
          <Dialog.Header>
            <Dialog.Title>{t("settings.apiKeys.revokeConfirm.title")}</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <Dialog.Body>
            <Stack gap="md">
              <Text as="p">{t("settings.apiKeys.revokeConfirm.body", { name: revokeTarget?.name ?? "" })}</Text>
              <Text as="p" color="muted" variant="bodySm">
                {t("settings.apiKeys.revokeConfirm.warning")}
              </Text>
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            <Inline gap="sm">
              <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
                {t("common.cancel")}
              </Button>
              <fetcher.Form
                method="post"
                onSubmit={() => {
                  // Optimistically close the confirm dialog — the row will
                  // rerender as "Revoked" once the loader revalidates.
                  setRevokeTarget(null)
                }}
              >
                <input type="hidden" name="intent" value="revokeApiKey" />
                <input type="hidden" name="keyId" value={revokeTarget?.id ?? ""} />
                <Button type="submit" variant="danger">
                  {t("settings.apiKeys.revokeConfirm.confirm")}
                </Button>
              </fetcher.Form>
            </Inline>
          </Dialog.Footer>
        </Dialog.Portal>
      </Dialog.Root>
    </Stack>
  )
}
