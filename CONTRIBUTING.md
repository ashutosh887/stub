# Contributing

Thanks for your interest in Stub. This guide covers the standards the repo enforces so changes stay
consistent.

## Setup

```bash
npm install          # also installs the Husky git hooks via the prepare script
cp .env.example .env  # set DSQL_* (and optionally OPENAI_API_KEY)
```

## Standards

- **Formatting**: [Prettier](https://prettier.io). Run `npm run format`; CI and the pre-commit hook
  run `npm run format:check`.
- **Linting**: [ESLint](https://eslint.org) with `eslint-config-next`. Run `npm run lint`
  (`npm run lint:fix` to autofix).
- **Types**: strict TypeScript. Run `npm run typecheck`.
- **Code style**: clean, self-explanatory code with no comments by default. Imports use the `@/*`
  alias (the tsconfig root); no `../../`.
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `chore:`, `docs:`, …), enforced by commitlint on the `commit-msg` hook.

## Git hooks

[Husky](https://typicode.github.io/husky) installs two hooks on `npm install`:

- **pre-commit** runs [lint-staged](https://github.com/lint-staged/lint-staged): ESLint `--fix` and
  Prettier over staged files, so unformatted or lint-breaking code can't be committed.
- **commit-msg** runs commitlint, so commit messages must follow Conventional Commits.

## Before opening a PR

```bash
npm run verify   # lint + typecheck + offline invariant suite
npm run build    # production build
```

The offline invariant suite (`npm test`) needs no database. The live cross-region proof
(`npm run test:live`) requires a configured Aurora DSQL cluster and is skipped without one.
