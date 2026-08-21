import { useEffect, useRef, useState } from "react"
import { css, html } from "react-strict-dom"
import { useTranslation } from "react-i18next"
import { useLinkTarget } from "~/hooks/useLinkTarget"
import { useFetcher, useRevalidator } from "react-router"
import { colors } from "@duro-app/tokens/tokens/colors.css"
import { spacing } from "@duro-app/tokens/tokens/spacing.css"
import {
  Alert,
  Button,
  Callout,
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  Inline,
  Input,
  LinkButton,
  Stack,
  Text,
  Textarea,
  type ToastOptions,
} from "@duro-app/ui"
import type { GitSshKey } from "~/lib/services/ForgejoClient.server"
import {
  looksLikePrivateKey,
  validateKeyTitle,
  validateSshPublicKey,
  MAX_SSH_KEYS,
  type GitKeysErrorCode,
  type SettingsGitKeysResult,
} from "~/lib/mutations/settings-git-keys"
import { useFetcherToast } from "~/lib/useFetcherToast"
import { useDisplayFormat } from "~/hooks/useDisplayFormat"
import { useCopyFeedback } from "~/hooks/useCopyFeedback"
import { CardSection } from "~/components/CardSection/CardSection"

/** Not i18n: a shell command is code, and a translator must not break it. */
const KEYGEN_COMMAND = 'ssh-keygen -t ed25519 -C "you@example.com"'

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
  // locates the just-added key without relying on colour alone (toast + focus
  // carry the meaning); persists until the next mutation, so no timer to clean.
  rowJustAdded: {
    backgroundColor: colors.successBg,
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderLeftColor: colors.successBorder,
    paddingLeft: spacing.sm,
  },
  fingerprint: {
    wordBreak: "break-all",
  },
  body: {
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
  },
})

interface GitKeysSectionProps {
  status: "account_missing" | "unavailable" | "ready"
  keys: GitSshKey[]
  username: string
  gitWebUrl: string
  heading: string
}

function gitToast(raw: unknown, t: (key: string) => string): ToastOptions | null {
  const d = raw as SettingsGitKeysResult | null
  if (!d) return null
  if ("gitKeyAdded" in d)
    return {
      variant: "success",
      message: d.alreadyPresent ? t("settings.git.add.alreadyPresent") : t("settings.git.add.success"),
    }
  if ("gitKeyDeleted" in d) return { variant: "success", message: t("settings.git.delete.success") }
  if ("gitKeyError" in d) return { variant: "error", message: errorMessage(d.gitKeyError, t) }
  return null
}

function errorMessage(code: GitKeysErrorCode, t: (key: string, opts?: Record<string, unknown>) => string): string {
  // Machine codes map to FIXED i18n strings — never render server prose (it
  // can echo submitted content). Service kinds live under errors.*, validation
  // reasons under validation.*; try both, then the generic fallback.
  for (const key of [`settings.git.errors.${code}`, `settings.git.validation.${code}`]) {
    const translated = t(key)
    if (translated !== key) return translated
  }
  return t("settings.git.errors.unknown")
}

export function GitKeysSection({ status, keys, username, gitWebUrl, heading }: GitKeysSectionProps) {
  const { t } = useTranslation()
  const linkProps = useLinkTarget()
  const { formatDate } = useDisplayFormat()
  const revalidator = useRevalidator()
  const fetcher = useFetcher<SettingsGitKeysResult>()
  useFetcherToast(fetcher, { render: (d) => gitToast(d, t) })
  const submitting = fetcher.state !== "idle"

  // --- add-form state (fully controlled: a private key never becomes a value)
  const [addOpen, setAddOpen] = useState(false)
  const [keyValue, setKeyValue] = useState("")
  const [title, setTitle] = useState("")
  const [titleTouched, setTitleTouched] = useState(false)
  const [titleAutofilled, setTitleAutofilled] = useState(false)
  const [panicked, setPanicked] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GitSshKey | null>(null)
  const [checkedOnce, setCheckedOnce] = useState(false)

  // The DS Button forwards no ref (follow-up DS gap), so the focus-restoration
  // point after cancel/delete is the CTA's wrapper: a React-ref'd, tabIndex=-1
  // span — the standard container-focus technique, no DOM querying involved.
  const addCtaRef = useRef<HTMLSpanElement | null>(null)
  const keyRef = useRef<HTMLTextAreaElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  const newRowRef = useRef<HTMLDivElement | null>(null)
  const { copied, copyFailed, copy } = useCopyFeedback()

  // Post-mutation reactions, render-phase (NOT an effect — the DevicesSection
  // pattern: an effect would cascade renders and misorder against revalidation).
  const [handledResult, setHandledResult] = useState<SettingsGitKeysResult | undefined>(undefined)
  const [justAddedId, setJustAddedId] = useState<number | null>(null)
  // Focus after ASYNC outcomes lives in setState-free effects (refs must not
  // be touched during render, and effects must not setState): the new row once
  // the revalidated list renders it, the header CTA after a delete settles.
  useEffect(() => {
    if (justAddedId != null) newRowRef.current?.focus()
  }, [justAddedId, keys])
  useEffect(() => {
    const d = fetcher.data
    if (d && "gitKeyDeleted" in d) addCtaRef.current?.focus()
  }, [fetcher.data])
  if (fetcher.data !== handledResult) {
    setHandledResult(fetcher.data)
    const d = fetcher.data
    if (d && "gitKeyAdded" in d) {
      setAddOpen(false)
      setKeyValue("")
      setTitle("")
      setTitleTouched(false)
      setTitleAutofilled(false)
      setPanicked(false)
      setKeyError(null)
      setTitleError(null)
      setJustAddedId(d.id) // the effect above focuses the row when it renders
    } else if (d && "gitKeyDeleted" in d) {
      setJustAddedId(null)
    } else if (d && "gitKeyError" in d) {
      // field-scoped codes land inline; the toast covers the rest
      const code = d.gitKeyError
      if (code === "title_taken" || code === "title_required" || code === "title_too_long") {
        setTitleError(errorMessage(code, t))
      } else if (
        code !== "unavailable" &&
        code !== "unauthorized" &&
        code !== "unconfigured" &&
        code !== "account_missing"
      ) {
        setKeyError(errorMessage(code, t))
      }
    }
  }

  const openAddForm = () => {
    setAddOpen(true)
    setTimeout(() => keyRef.current?.focus(), 0)
  }
  const closeAddForm = () => {
    setAddOpen(false)
    setKeyValue("")
    setTitle("")
    setTitleTouched(false)
    setTitleAutofilled(false)
    setPanicked(false)
    setKeyError(null)
    setTitleError(null)
    setTimeout(() => addCtaRef.current?.focus(), 0)
  }

  const handleKeyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    // PANIC PATH FIRST: a private key never reaches React state. The DOM held
    // it for one frame (the user put it there); the controlled reset clears it.
    if (looksLikePrivateKey(next)) {
      setKeyValue("")
      setPanicked(true)
      setKeyError(null)
      if (titleAutofilled) {
        setTitle("")
        setTitleAutofilled(false)
        setTitleTouched(false)
      }
      return
    }
    if (panicked && next.trim() !== "") setPanicked(false)
    setKeyValue(next)
    // re-validate live only once the field is already in error (quiet typing,
    // instant recovery feedback on paste-after-error)
    if (keyError !== null) {
      const v = validateSshPublicKey(next)
      setKeyError(v.ok ? null : t(`settings.git.validation.${v.reason}`))
    }
    // comment → title prefill, until the user edits the title themselves
    if (!titleTouched) {
      const v = validateSshPublicKey(next)
      if (v.ok && v.comment) {
        setTitle(v.comment.slice(0, 100))
        setTitleAutofilled(true)
      }
    }
  }

  const handleKeyBlur = () => {
    if (keyValue.trim() === "") return
    const v = validateSshPublicKey(keyValue)
    setKeyError(v.ok ? null : t(`settings.git.validation.${v.reason}`))
  }

  const handleSubmit = (e: React.FormEvent) => {
    const keyCheck = validateSshPublicKey(keyValue)
    const titleCheck = validateKeyTitle(title)
    if (!keyCheck.ok || !titleCheck.ok) {
      e.preventDefault()
      if (!keyCheck.ok) setKeyError(t(`settings.git.validation.${keyCheck.reason}`))
      if (!titleCheck.ok) setTitleError(t(`settings.git.validation.${titleCheck.reason}`))
      if (!keyCheck.ok) keyRef.current?.focus()
      else titleRef.current?.focus()
      return
    }
    setKeyError(null)
    setTitleError(null)
  }

  // ---------------------------------------------------------------- states --

  if (status === "account_missing") {
    return (
      <CardSection title={heading}>
        <html.div style={styles.body}>
          <Stack gap="md">
            <Callout variant="info" icon="git-branch">
              <Stack gap="sm">
                <Text as="p" weight="semibold">
                  {t("settings.git.accountMissing.title")}
                </Text>
                <Text as="p">{t("settings.git.accountMissing.body")}</Text>
              </Stack>
            </Callout>
            <Inline gap="sm">
              <LinkButton href={gitWebUrl} variant="primary" {...linkProps}>
                {t("settings.git.openForge")}
              </LinkButton>
              <Button
                variant="secondary"
                disabled={revalidator.state !== "idle"}
                onClick={() => {
                  setCheckedOnce(true)
                  revalidator.revalidate()
                }}
              >
                {revalidator.state !== "idle"
                  ? t("settings.git.accountMissing.rechecking")
                  : t("settings.git.accountMissing.recheck")}
              </Button>
            </Inline>
            <Text as="p" variant="bodySm" color="muted">
              {t("settings.git.accountMissing.hint")}
            </Text>
            {checkedOnce && revalidator.state === "idle" && (
              <Text as="p" variant="bodySm" color="muted">
                {t("settings.git.accountMissing.stillMissing")}
              </Text>
            )}
          </Stack>
        </html.div>
      </CardSection>
    )
  }

  if (status === "unavailable") {
    return (
      <CardSection title={heading}>
        <html.div style={styles.body}>
          <Stack gap="md">
            <Alert variant="warning">
              <Stack gap="xs">
                <Text as="p" weight="semibold">
                  {t("settings.git.unavailable.title")}
                </Text>
                <Text as="p">{t("settings.git.unavailable.body")}</Text>
              </Stack>
            </Alert>
            <Inline gap="sm">
              <Button
                variant="secondary"
                disabled={revalidator.state !== "idle"}
                onClick={() => revalidator.revalidate()}
              >
                {revalidator.state !== "idle"
                  ? t("settings.git.unavailable.retrying")
                  : t("settings.git.unavailable.retry")}
              </Button>
            </Inline>
          </Stack>
        </html.div>
      </CardSection>
    )
  }

  const sorted = [...keys].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const atCap = keys.length >= MAX_SSH_KEYS

  return (
    <CardSection
      title={heading}
      action={
        <html.span ref={addCtaRef} tabIndex={-1}>
          <Button variant="primary" disabled={addOpen || atCap} onClick={openAddForm}>
            {t("settings.git.add.open")}
          </Button>
        </html.span>
      }
    >
      <html.div style={styles.body}>
        <Stack gap="md">
          <Text as="p" color="muted">
            {t("settings.git.description")}
          </Text>

          <Inline gap="sm" align="center">
            <Text as="span" variant="bodySm" color="muted">
              {t("settings.git.account", { username })}
            </Text>
            <LinkButton href={gitWebUrl} variant="secondary" size="small" {...linkProps}>
              {t("settings.git.openForge")}
            </LinkButton>
          </Inline>

          {atCap && (
            <Text as="p" variant="bodySm" color="muted">
              {t("settings.git.add.atCap", { max: MAX_SSH_KEYS })}
            </Text>
          )}

          {addOpen && (
            <fetcher.Form method="post" onSubmit={handleSubmit}>
              <html.input type="hidden" name="intent" value="addGitKey" />
              <Stack gap="lg">
                <Text as="p" variant="bodySm" color="muted">
                  {t("settings.git.add.description")}
                </Text>

                {panicked && (
                  <Alert variant="error">
                    <Stack gap="xs">
                      <Text as="p" weight="semibold">
                        {t("settings.git.privateKey.title")}
                      </Text>
                      <Text as="p">{t("settings.git.privateKey.body")}</Text>
                      <Text as="p" variant="bodySm">
                        {t("settings.git.privateKey.rotateHint")}
                      </Text>
                    </Stack>
                  </Alert>
                )}

                <Field.Root invalid={keyError !== null}>
                  <Field.Label>{t("settings.git.add.keyLabel")}</Field.Label>
                  <Textarea
                    ref={keyRef}
                    name="publicKey"
                    rows={4}
                    value={keyValue}
                    disabled={submitting}
                    placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI… you@laptop"
                    onChange={handleKeyChange}
                    onBlur={handleKeyBlur}
                    required
                  />
                  <Field.Description>
                    {t("settings.git.add.keyHint")} {t("settings.git.add.keygenPrompt")}{" "}
                    <Text as="span" variant="code">
                      {KEYGEN_COMMAND}
                    </Text>{" "}
                    <Button variant="link" size="small" type="button" onClick={() => copy(KEYGEN_COMMAND)}>
                      {copyFailed
                        ? t("settings.git.add.copyCommandFailed")
                        : copied
                          ? t("settings.git.add.copiedCommand")
                          : t("settings.git.add.copyCommand")}
                    </Button>
                  </Field.Description>
                  {keyError && <Field.Error>{keyError}</Field.Error>}
                </Field.Root>

                <Field.Root invalid={titleError !== null}>
                  <Field.Label>{t("settings.git.add.titleLabel")}</Field.Label>
                  <Input
                    ref={titleRef}
                    name="title"
                    value={title}
                    disabled={submitting}
                    placeholder={t("settings.git.add.titlePlaceholder")}
                    onChange={(e) => {
                      setTitle(e.target.value)
                      setTitleTouched(true)
                      setTitleAutofilled(false)
                      if (titleError !== null) setTitleError(null)
                    }}
                    required
                  />
                  <Field.Description>
                    {titleAutofilled ? t("settings.git.add.titleAutofilled") : t("settings.git.add.titleHint")}
                  </Field.Description>
                  {titleError && <Field.Error>{titleError}</Field.Error>}
                </Field.Root>

                <Inline gap="sm">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={submitting || keyValue.trim() === "" || title.trim() === ""}
                  >
                    {submitting ? t("settings.git.add.submitting") : t("settings.git.add.submit")}
                  </Button>
                  <Button type="button" variant="secondary" disabled={submitting} onClick={closeAddForm}>
                    {t("common.cancel")}
                  </Button>
                </Inline>
              </Stack>
            </fetcher.Form>
          )}

          {sorted.length === 0 ? (
            <EmptyState
              icon={<Icon name="git-branch" size="md" />}
              message={t("settings.git.empty.message")}
              action={
                <Button variant="primary" onClick={openAddForm}>
                  {t("settings.git.add.open")}
                </Button>
              }
            />
          ) : (
            sorted.map((k, idx) => (
              <html.div
                key={k.id}
                ref={k.id === justAddedId ? newRowRef : undefined}
                tabIndex={k.id === justAddedId ? -1 : undefined}
                style={[styles.row, idx === 0 && styles.firstRow, k.id === justAddedId && styles.rowJustAdded]}
              >
                <Stack gap="xs">
                  <Text as="span" weight="semibold">
                    {k.title}
                  </Text>
                  <html.span style={styles.fingerprint}>
                    <Text as="span" variant="code" color="muted">
                      {k.fingerprint}
                    </Text>
                  </html.span>
                  <Text as="span" variant="bodySm" color="muted">
                    {t("settings.git.list.added", { date: formatDate(k.createdAt) })}
                  </Text>
                </Stack>
                <Button
                  variant="secondary"
                  size="small"
                  aria-label={t("settings.git.list.deleteAria", { title: k.title })}
                  onClick={() => setDeleteTarget(k)}
                >
                  {t("settings.git.list.delete")}
                </Button>
              </html.div>
            ))
          )}
        </Stack>
      </html.div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t("settings.git.delete.title")}
        cancelLabel={t("common.cancel")}
        size="sm"
        confirmSlot={() => (
          <fetcher.Form method="post" onSubmit={() => setDeleteTarget(null)}>
            <html.input type="hidden" name="intent" value="deleteGitKey" />
            <html.input type="hidden" name="keyId" value={String(deleteTarget?.id ?? "")} />
            <Button type="submit" variant="danger">
              {t("settings.git.delete.confirm")}
            </Button>
          </fetcher.Form>
        )}
      >
        <Stack gap="sm">
          <Text as="p">{t("settings.git.delete.body", { title: deleteTarget?.title ?? "" })}</Text>
          <Stack gap="xs">
            <Text as="span" variant="bodySm" color="muted">
              {t("settings.git.delete.fingerprintLabel")}
            </Text>
            <html.span style={styles.fingerprint}>
              <Text as="span" variant="code">
                {deleteTarget?.fingerprint ?? ""}
              </Text>
            </html.span>
          </Stack>
        </Stack>
      </ConfirmDialog>
    </CardSection>
  )
}
