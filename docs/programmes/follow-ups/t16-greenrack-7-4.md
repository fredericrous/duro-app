+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
due = "2026-12-05"
repos = ["duro-app"]
+++

# Move duro-app to greenrack 7.4

## Question

greenrack 7.3 and 7.4 shipped on 2026-11-21 (Field's native validation message, Combobox). duro-app runs 7.2.1. Move it to 7.4.x; the doctor row `@greenharness/greenrack-cli@^7` and the postcss/vite `node_modules` src glob move with it.

## Look at

- `package.json` and the lockfile, the doctor row, the postcss and vite configs.
- greenrack's CHANGELOG for 7.3.0 and 7.4.0.

## Answer looks like

A merged PR on greenrack 7.4.x, with a browser check of the screens that use Field and Combobox, compared with the 7.2.1 build.
