# Setup Module

## Scope

This module owns new-machine developer and packager setup checks. It does not configure end-user runtime data; runtime checks stay inside the Settings environment page.

## Commands

- `npm run setup:doctor` checks Node, npm, locked dependencies, Electron binaries, local build caches, and the public MySQL template.
- `npm run setup:install` installs dependencies through project-local caches and then runs the doctor.

## Cache Rules

Build-time caches live under `.tmp/build-cache`:

- `.tmp/build-cache/npm`
- `.tmp/build-cache/electron`
- `.tmp/build-cache/electron-builder`

The directory is ignored by git. For an offline packaging machine, prime these caches once on an online machine, then copy `.tmp/build-cache` and `node_modules` with the source tree.

## Boundaries

- Do not write setup caches to `C:\` when a project-local path is available.
- Do not make MySQL a setup blocker; the app can start in local fallback mode.
- Do not print raw stack traces in setup output unless a maintainer runs the underlying command manually.
