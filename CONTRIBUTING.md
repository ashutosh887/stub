# Contributing

The standards the repo enforces, and how to release the SDK.

## Setup

```bash
npm install          # also installs the Husky git hooks via the prepare script
cp .env.example .env  # set DSQL_* (and optionally OPENAI_API_KEY)
```

## Standards

- **Formatting**: [Prettier](https://prettier.io). Run `npm run format`. CI runs
  `npm run format:check`, and the pre-commit hook formats staged files.
- **Linting**: [ESLint](https://eslint.org) with `eslint-config-next`. Run `npm run lint`
  (`npm run lint:fix` to autofix).
- **Types**: strict TypeScript. Run `npm run typecheck`.
- **Code style**: clean, self-explanatory code with no comments by default. Imports use the `@/*`
  alias (the tsconfig root); no `../../`.
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `chore:`, `docs:` and so on), enforced by commitlint on the `commit-msg` hook.

## Git hooks

[Husky](https://typicode.github.io/husky) installs two hooks on `npm install`:

- **pre-commit** runs [lint-staged](https://github.com/lint-staged/lint-staged): ESLint `--fix` and
  Prettier over staged files, so unformatted or lint-breaking code can't be committed.
- **commit-msg** runs commitlint, so commit messages must follow Conventional Commits.

## Before opening a PR

```bash
npm run verify       # lint, typecheck, offline invariant suite
npm run build        # production build
npm run test:local   # needs DATABASE_URL and STUB_APP_PASSWORD; run migrate and db:app-role first
```

The offline invariant suite (`npm test`) needs no database. `npm run test:local` needs local
Postgres with the schema and the `stub_app` role; it races ten agents on one budget and sends the
`/proof` statements as `stub_app`. CI's `db-proof` job runs it on Postgres 17 for every push to
`main` and every pull request, so a change that lets `stub_app` overspend or rewrite the ledger
fails there. The live cross-Region proof (`npm run test:live`) needs a configured Aurora DSQL
cluster and skips without one.

If the change alters the `trystub` API, or server behaviour and configuration that callers depend on,
add a bullet under `## [Unreleased]` in [`sdk/CHANGELOG.md`](./sdk/CHANGELOG.md). Prefix server-only
entries with `Stub server:` so nobody hunts for them in the package. Console styling, marketing
pages, docs, and internal refactors do not belong there. Write each entry for someone deciding
whether to upgrade, not for someone reading the diff.

## Releasing the SDK

[`sdk/CHANGELOG.md`](./sdk/CHANGELOG.md) is the source of truth for release notes.
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format, [SemVer](https://semver.org)
versions: breaking change is a major, new feature is a minor, fix is a patch.

1. Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, add a fresh empty `## [Unreleased]` above
   it, and update the compare links at the bottom.
2. Set the same `X.Y.Z` in `sdk/package.json`. The workflow fails the release if the two disagree.
3. Commit, then tag and push:

```bash
git tag sdk-vX.Y.Z && git push origin sdk-vX.Y.Z
```

The `Publish SDK` workflow builds and publishes to npm with provenance. It does not create the
GitHub Release, so the release carries the maintainer's name rather than a bot's. Create it from
that version's changelog section:

```bash
awk -v h="## [X.Y.Z]" 'index($0,h)==1{f=1;next} f&&index($0,"## [")==1{exit} f' sdk/CHANGELOG.md > notes.md
gh release create sdk-vX.Y.Z --title "trystub X.Y.Z" --notes-file notes.md --latest
```

The workflow has no npm token. It publishes through npm trusted publishing: GitHub Actions hands npm
a short-lived OIDC token (`id-token: write`), and npm accepts it only for the publisher configured
on the package. One-time setup on npmjs.com: package `trystub` → Settings → Trusted publishing →
GitHub Actions, organization or user `ashutosh887`, repository `stub`, workflow `publish-sdk.yml`.
Then delete the `NPM_TOKEN` repository secret, revoke the token on npmjs.com, and set the package's
publishing access to require two-factor authentication and disallow tokens.

## Security checks

`.github/workflows/security.yml` runs on every push to `main`, every pull request and weekly:
`npm audit --audit-level=high` (fails on a high or critical advisory), gitleaks over the full git
history, CodeQL (`security-extended`) and `cfn-lint` over `infra/`. Dependabot opens weekly update
pull requests for the app, the SDK and the workflow actions.
