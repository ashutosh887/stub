# Database guardrail

A GitHub Action that connects to Postgres or Aurora DSQL as your application role and sends
statements that role must never be allowed to run. Each one runs inside `BEGIN` and `ROLLBACK`.
The step fails if the database accepts any of them, or refuses one with a SQLSTATE other than the
one you expect.

A green run proves that the database itself refuses those writes for that role. It does not depend
on your application code getting every check right. Stub uses it in CI to prove its app role
cannot drive a budget below zero, raise a balance past its cap, rewrite or delete a ledger entry,
or create and drop tables.

```yaml
- uses: ashutosh887/stub/.github/actions/db-guardrail@main
```

Pin a commit SHA in place of `main` if you want the action to stay exactly as you reviewed it.

## Inputs

| Input               | Required | Default | What it does                                                                               |
| ------------------- | -------- | ------- | ------------------------------------------------------------------------------------------ |
| `database-url`      | yes      |         | `postgres://user[:password]@host:port/db`, with an optional `?sslmode=`.                   |
| `password`          | no       | `""`    | Replaces the password in `database-url`. Use it for an IAM token so you skip URL encoding. |
| `probes`            | yes      |         | Path to your probe file, relative to the workspace.                                        |
| `require-non-owner` | no       | `true`  | Refuse to run when the role is a superuser or owns a table that a probe names. See below.  |

TLS follows `sslmode` in the URL. `require`, `verify-ca` and `verify-full` all verify the server
certificate against the system CAs. For a DSQL endpoint with no `sslmode`, the action sets
`verify-full`, and it refuses `disable`, `allow` and `prefer`.

The action needs Node 20 or later and npm on the runner. GitHub-hosted runners have both. It
installs one pinned dependency, `pg`, from the lockfile next to `action.yml`.

## Probe file

A JSON array. Each probe has an `id`, the `sql` to send, and the SQLSTATE the database must
`expect`. `description` is optional. Any other key fails the run, so a typo like `expected` cannot
pass silently.

```json
[
  {
    "id": "rewrite-entry",
    "description": "Rewrite a ledger entry",
    "sql": "UPDATE entries SET amount_micro = 0 WHERE id = (SELECT id FROM entries ORDER BY id LIMIT 1)",
    "expect": "42501"
  },
  {
    "id": "negative-balance",
    "sql": "UPDATE accounts SET balance_micro = -1 WHERE id = (SELECT id FROM accounts ORDER BY id LIMIT 1)",
    "expect": "23514"
  }
]
```

Common codes are `42501` for a missing privilege and `23514` for a failed `CHECK` constraint. Stub's
own probes are in [`test/guardrail/probes.json`](../../../test/guardrail/probes.json).

Each probe gets one of these outcomes:

- `refused`. The database returned the expected SQLSTATE. This is the only passing outcome.
- `wrong SQLSTATE`. It refused, but with a different code. Check whether it hit the rule you meant.
- `ACCEPTED`. The database ran it. The action rolled it back, and the step fails.
- `no row`. An `UPDATE` or `DELETE` matched nothing, so it tested nothing. Seed a row first.

The runner sends each probe as one statement over the extended query protocol, so a probe cannot
smuggle in a second statement or a `COMMIT`. Probes that start with transaction control such as
`COMMIT` or `SAVEPOINT` are rejected before the action connects. Nothing a probe does is committed.

Results print as a table in the log and go to the job summary.

## The owner check

Grants do not bind the owner of a table, and they do not bind a superuser. Point the action at an
owner and `UPDATE entries` succeeds, `DROP TABLE` succeeds, and the run tells you about the
owner's powers instead of your app role's. Any probe that does pass says nothing about the role
your application uses.

So before it sends any probe, the action finds every table named after `FROM`, `UPDATE`, `INTO`,
`JOIN`, `TABLE`, `TRUNCATE` or `ON` in your probes. It refuses to run if the connected role is a
superuser, or is a member of the role that owns one of those tables. Connect as the role your
application uses. Set `require-non-owner: false` only if you know why you need it.

## Plain Postgres

Apply your schema and grants as the owner, seed the rows your probes need, then run the action as
the app role.

```yaml
jobs:
  guardrail:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: owner
          POSTGRES_PASSWORD: owner
          POSTGRES_DB: app
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U owner -d app"
          --health-interval 2s
          --health-timeout 3s
          --health-retries 20
    env:
      OWNER_URL: postgres://owner:owner@localhost:5432/app
    steps:
      - uses: actions/checkout@v7
      - run: |
          psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
          psql "$OWNER_URL" -v ON_ERROR_STOP=1 -c "CREATE ROLE app_user LOGIN PASSWORD 'ci-only'"
          psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f db/grants.sql
          psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f db/seed.sql
      - uses: ashutosh887/stub/.github/actions/db-guardrail@main
        with:
          database-url: postgres://app_user@localhost:5432/app
          password: ci-only
          probes: guardrail/probes.json
```

## Aurora DSQL

DSQL has no passwords. You connect with a short-lived IAM auth token, which the AWS CLI generates.
Use `generate-db-connect-auth-token` for a custom role such as your app role. Use
`generate-db-connect-admin-auth-token` only for the `admin` role, and expect the owner check to
refuse it, because `admin` usually owns your tables.

One-time setup:

1. Create an IAM role that GitHub can assume over OIDC, allowed `dsql:DbConnect` on the cluster.
2. As `admin`, map it to your database role:
   `AWS IAM GRANT app_user TO 'arn:aws:iam::<account-id>:role/<role-name>';`
3. Store the role ARN and the cluster endpoint as repository variables or secrets.

```yaml
jobs:
  guardrail:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    env:
      AWS_REGION: us-east-1
      DSQL_ENDPOINT: ${{ vars.DSQL_ENDPOINT }}
    steps:
      - uses: actions/checkout@v7
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: ${{ secrets.GUARDRAIL_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}
      - name: Generate a DSQL auth token
        run: |
          token=$(aws dsql generate-db-connect-auth-token \
            --hostname "$DSQL_ENDPOINT" --region "$AWS_REGION" --expires-in 900)
          echo "::add-mask::$token"
          echo "DSQL_TOKEN=$token" >> "$GITHUB_ENV"
      - uses: ashutosh887/stub/.github/actions/db-guardrail@main
        with:
          database-url: postgres://app_user@${{ env.DSQL_ENDPOINT }}:5432/postgres?sslmode=verify-full
          password: ${{ env.DSQL_TOKEN }}
          probes: guardrail/probes.json
```

Mask the token before anything else prints it, as above. The action also masks whatever it gets as
a password, but GitHub can log a step's inputs before the action starts.

Probes against a live cluster still roll back, but they do run. Point them at rows that exist, and
run them against a staging cluster first if you are unsure what a statement does.
