# jpd-app-kit

A personal Claude Code plugin that scaffolds a new web app end-to-end: a private GitHub repo in your configured org, a child AWS account in your AWS Organization, an optional Route 53 domain, and a CodePipeline-driven CDK deployment that mirrors the `daily-deutsch` reference shape.

## First-time setup

The plugin reads configuration from `~/.config/jpd-app-kit/config.json`. Copy the example and fill in **your** values:

```bash
mkdir -p ~/.config/jpd-app-kit
cp <path-to-plugin>/config.json.example ~/.config/jpd-app-kit/config.json
$EDITOR ~/.config/jpd-app-kit/config.json
```

You'll need to supply:

| Field | What it is |
| --- | --- |
| `aws.mgt_account_id` | The 12-digit ID of your AWS Organizations management account. |
| `aws.sso_start_url` | Your IAM Identity Center start URL, e.g. `https://d-XXXXXXXXXX.awsapps.com/start`. |
| `aws.sso_region` | The region your SSO instance lives in (commonly `us-east-1`). |
| `aws.default_region` | The region your apps deploy into. |
| `aws.sso_role_name` | The role each child account auto-receives (default `AdministratorAccess`). |
| `aws.account_email_template` | A template like `you+{app_name}@example.com`. `{app_name}` is substituted per app; AWS requires the resulting email to be globally unique across all of AWS. |
| `github.org` | The GitHub org new repos go under. The plugin defaults the repo visibility to private. |
| `developer_dir` | Absolute path to where you keep your projects (e.g. `$HOME/Developer`). The orchestrator creates `./<app-name>` from here. |
| `developer_dir_symlinks` | Optional list of paths that are symlinks to `developer_dir`, accepted as valid `cwd`s. |

The plugin never reads from any other location. Preflight fails fast if this file is missing or fields are blank.

## Running it

Once the config is in place:

1. **`cd` to your `developer_dir`** — new apps land in `./<app-name>` relative to where you launch Claude.
2. **Sign into the AWS management account.** Child accounts and domain registration both run from `mgt`.
   ```bash
   aws sso login --profile mgt
   ```
3. **Sign into `gh`** if you aren't already (`gh auth status` to check).

Then launch Claude with the plugin loaded:

```bash
claude --plugin-dir <path-to-plugin>
```

Inside Claude:

```
/jpd-app-kit:new-app
```

The orchestrator gathers inputs in one prompt (app name, stack, optional domain, Cognito y/n, protected API y/n, LLM Lambda y/n), then runs through the workflow.

### What `/new-app` does, in order

| # | Step | Confirmation? | What it produces |
| - | --- | --- | --- |
| 0 | Preflight | — | Verifies the config file, cwd, CLIs, `mgt` SSO, `gh` + configured-org membership, CDK reachable. Stops the run if anything fails. |
| 1 | Local scaffold + `git init` | none | `./<app-name>/` with templates filled in, Vite/Next.js app scaffolded, `cdk/` copied with placeholders. |
| 2 | **GitHub repo + initial commit** | none | Private `<github.org>/<app-name>` repo created via `gh`, scaffold pushed to `main`. *Happens before AWS provisioning so your code is versioned immediately, even if later steps fail.* |
| 3 | AWS child account | **yes** | New `child-<app-name>` account via `aws organizations create-account` (run from `mgt`), polled to SUCCESS, then `~/.aws/config` is appended with the matching SSO profile. The new account ID is committed back to `cdk/bin/app.ts`. |
| 4 | Route 53 domain | **yes** (skipped entirely if you said no) | Domain registered from `mgt`, hosted zone created in the child account, registrar pointed at the child zone's nameservers. |
| 5 | CDK first deploy | **yes** | `cdk bootstrap` + `cdk diff` (shown for approval) + `cdk deploy` against the child account. Stack outputs (`SiteUrl`, `UserPoolId`, `ApiUrl`, etc.) are printed. If Cognito was selected, `.env.local` is written and the frontend auth bundle is committed. |
| 6 | Wrap-up | — | Opens the project in your editor, prints the `AuthorizeConnectionUrl` you must click to finish wiring the CodeStar GitHub connection. |

### Why GitHub comes before AWS

A common failure mode in this kind of workflow is getting halfway through, hitting an AWS quota or an SSO timeout, and having no record of the scaffolded code. By creating the repo + initial commit *first*, you keep the codebase even if the AWS side later needs a do-over. The first commit ships with `{{AWS_ACCOUNT_ID}}` as a placeholder — that's fine because `cdk synth` isn't run yet; step 3 commits the substitution as a follow-up.

### Install for ongoing use

If you'd rather not pass `--plugin-dir` every time, symlink the plugin into a path Claude already loads:

```bash
ln -s <path-to-this-clone> ~/.claude/plugins/jpd-app-kit
```

Then `/reload-plugins` from any Claude Code session.

## Commands

| Skill | What it does |
| --- | --- |
| `/jpd-app-kit:preflight` | Verify prereqs: config file exists, local CLIs (`aws`, `gh`, `mise`, `node`, `npm`, `git`, `npx`), `mgt` SSO session is live and matches `aws.mgt_account_id` from config, GitHub is authed with configured-org membership + `repo`/`admin:org` scopes, and CDK is reachable via npx. Always runs first as step 0 of `/new-app`. |
| `/jpd-app-kit:new-app` | End-to-end orchestrator. Runs preflight, then walks through all six steps and confirms before each billable / destructive action. |
| `/jpd-app-kit:aws-account` | Create a new child account in your AWS Organization (run from the `mgt` profile) and add a matching SSO profile to `~/.aws/config`. |
| `/jpd-app-kit:domain` | Check Route 53 domain availability and register if approved. |
| `/jpd-app-kit:github-repo` | Create a private repo under your configured GitHub org (`github.org` in config) with sensible defaults. |
| `/jpd-app-kit:cdk-stack` | Generate the CDK stack from `templates/vite/cdk/` or `templates/nextjs/cdk/` and run the first deploy. |

## Conventions captured

- **AWS org**: management account from `aws.mgt_account_id`; SSO start URL from `aws.sso_start_url`; child accounts named `child-<app>` with role from `aws.sso_role_name` (default `AdministratorAccess`) in `aws.default_region`.
- **Toolchain**: `mise` pins `node 24.14.0` + `python 3.12`; `AWS_PROFILE` + `AWS_DEFAULT_REGION` exported via `mise.toml`.
- **Frontend**: Vite + React 18 + TypeScript + Tailwind + shadcn/ui (default) **or** Next.js 15 (static export to the same CDK stack).
- **Infra**: S3 (private, OAC) + CloudFront + CodeStar Connection + CodeBuild test + CodeBuild build/deploy. Custom domain (ACM cert + Route 53 + www→apex redirect) is optional — picking "skip" in `/new-app` serves the app from CloudFront's default URL instead.
- **Optional blocks (per app, prompted in `/new-app`):**
  - **Cognito** — UserPool + UserPoolClient with email sign-up, email-verify required, SRP auth flow. On Vite, also drops in shadcn-based SignIn/SignUp/ConfirmSignUp forms, `AuthProvider`, `AuthGuard`, and a `lib/auth.ts` SDK wrapper.
  - **Protected HTTP API** — API Gateway HTTP API + `HttpJwtAuthorizer` against the user pool + sample `GET /hello` Lambda. Frontend gets `lib/api.ts` with `apiFetch()` that auto-attaches the ID token. Requires Cognito.
  - **LLM Lambda** — daily-deutsch-style unauthenticated Lambda Function URL that proxies Bedrock. CORS-only, no JWT. Independent of Cognito/API.
- **GitHub**: org from `github.org`, default branch `main`, private.

See each skill's `SKILL.md` for the step-by-step behavior the model follows.
