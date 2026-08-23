# ADR 0006: Publish npm releases through a trusted GitHub workflow

Status: Accepted
Date: 2026-08-23

## Context

Publishing `@zilliz/dsh-milvus` from a maintainer workstation depends on a
human npm session and may require a new OTP for every release. A reusable npm
access token would avoid the prompt, but would create a long-lived secret that
must be stored, rotated, and protected.

## Decision

Use npm Trusted Publishing with GitHub Actions OIDC. npm trusts only the
`zilliztech/dsh-milvus` repository and its exact `publish.yml` workflow. The
workflow runs on a GitHub-hosted runner, requests `id-token: write`, installs a
supported Node.js and npm toolchain, runs the default tests, rejects an existing
version, and publishes without an npm token.

The automatic trigger is a `package.json` or `package-lock.json` change merged
into `master`, matching the existing version-bump pull request release flow. A
manual trigger exists for recovery and is subject to the same tests and
duplicate-version guard.

## Consequences

- Routine releases no longer depend on a maintainer workstation, stored npm
  tokens, or OTP entry.
- The GitHub repository and workflow identity become part of the npm publishing
  security boundary; renaming or moving either requires updating npm first.
- A package metadata change without a version bump produces a visible failed
  publishing run instead of silently republishing an existing version.
- The first future version release must prove the OIDC path before token-based
  publishing is disabled in npm package access settings.
