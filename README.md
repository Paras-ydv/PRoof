# PRoof

PRoof triages pull requests before a maintainer opens them. It posts one card on each PR with a summary, a readiness score, and the evidence behind every flag, and sends the full report to your team in Slack, Discord, email or a webhook.

It's built for the three things that eat review time: PRs the author can't explain, PRs with no linked issue, and "can I work on this?" claims that go quiet.

- **Evidence over verdicts.** Every flag links to the file and line that triggered it.
- **Maintainers decide.** PRoof never closes, rejects or blocks a PR.
- **Newcomers get a how-to, not a penalty.** Each flag links to a short guide in [docs/rules](docs/rules).
- **Shadow mode first.** Every check starts visible to maintainers only. Turn a check live when you trust it.

## What it checks

The **readiness score** (out of 100) rates the PR:

| Check | Default points | How it works |
| --- | --- | --- |
| Linked issue | 15 | GitHub's linked issues, plus assignment or a `/claim` |
| PR template | 10 | Each template section has real content |
| CI | 15 | Required checks on the head commit; fork approval counts as pending |
| Tests | 15 | Source changed with tests; no tests or assertions removed |
| Ghost code | 20 | tree-sitter index of the repo: calls and imports on added lines that exist nowhere |
| Size | 10 | Changed lines, ignoring lockfiles and generated files |
| Questions | 15 | Optional: 1–3 questions on changed lines, answered in the PR thread |

Checks that don't apply drop out and the rest scale back to 100.

**About the contributor** (spray pattern, history with the repo) is shown to maintainers only, as evidence. It never changes the score and is never posted on the PR. PRoof deliberately does not use "AI-written" detectors or account age.

Orgs can add their own rules in the dashboard (title format, required labels, protected paths, paths that need tests, file limits), or point PRoof at their own service as an **external check**.

## Where to verify what PRoof does

Everything that judges a PR lives in [`packages/core`](packages/core) and has no network or database access:

- Scoring and the report: [`report.ts`](packages/core/src/report.ts)
- Each check: [`checks/`](packages/core/src/checks) and [`ghost/`](packages/core/src/ghost)
- The exact prompts sent to the AI model: [`ai/prompts.ts`](packages/core/src/ai/prompts.ts)
- What appears on the PR: [`render/`](packages/core/src/render)

The AI model sees the PR's title, description and diff, and the author's answers. It never sees contributor history. PR text is treated as untrusted input, and every model reply is validated against a schema. Scoring itself never uses AI.

Secrets (AI keys, Slack tokens, webhook URLs) are encrypted with AES-256-GCM and are never returned by the API. Every settings change is written to an audit log.

## Who can set up an org

PRoof is installed through GitHub's own install page, and only org owners can install it. When GitHub sends someone back to PRoof, the installation is checked against that user's own GitHub token before it's trusted. Each org gets exactly one workspace, keyed on GitHub's permanent account id. Roles are always read from GitHub: org owners change workspace settings, and repo admins change their repo's overrides.

## Run it

You need Node 22, pnpm 10 and Docker.

```sh
pnpm install
docker compose up -d postgres        # Postgres on localhost:5433
cp .env.example .env                 # then fill in the GitHub App values
pnpm db:migrate
pnpm dev                             # API on :3100, dashboard on :5173
```

To explore the dashboard without a GitHub App, run it on sample data:

```sh
pnpm --filter @proof/web demo
```

### Create the GitHub App

Create a GitHub App with the permissions, events and URLs in [`github-app.yml`](github-app.yml). Then put its App ID, private key, webhook secret, client ID and client secret in `.env`, and generate an encryption key with `openssl rand -base64 32`.

### Deploy

The [`Dockerfile`](Dockerfile) builds one image that serves the API, the queue workers and the dashboard on one origin. It needs Postgres and the environment variables in [`.env.example`](.env.example). Migrations run on start. CI publishes the image to GitHub Container Registry after tests pass on `main`.

## Project layout

```
packages/core    checks, scoring, renderers, prompts (pure, fully tested)
packages/db      Postgres schema and migrations (Drizzle)
apps/server      webhooks, job queue, GitHub and AI clients, dashboard API
apps/web         the dashboard (React)
docs/rules       how-to-fix guides linked from PR cards
```

## Tests

```sh
pnpm typecheck
pnpm test        # needs the local Postgres for the db and server suites
```

## Feedback and feature requests

Use **Request a feature** in the dashboard, or open a GitHub Discussion in this repository.
