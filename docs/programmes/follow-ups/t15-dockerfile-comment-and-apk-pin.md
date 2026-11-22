+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
due = "2026-12-05"
repos = ["duro-app"]
+++

# The Dockerfile's comment still names @duro-app

## Question

Line 6 of `Dockerfile` still mentions `@duro-app` in a comment. Any Dockerfile commit is blocked by hadolint DL3018 (an unpinned `apk add`), so the comment could not ride the sweep. Pin the apk packages, then fix the comment.

## Look at

- `Dockerfile` (line 6 and the `apk add` line).
- hadolint DL3018 and the Alpine version the base image uses.

## Answer looks like

A PR whose Dockerfile passes hadolint, with the apk packages pinned and no `@duro-app` left in it; the image builds.
