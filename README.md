# jpd-app-kit

A personal Claude Code plugin that scaffolds a new web app end-to-end: a private GitHub repo in your configured org, a child AWS account in your AWS Organization, an optional Route 53 domain, and a CodePipeline-driven CDK deployment that mirrors the `daily-deutsch` reference shape.

## Prerequisites

This plugin assumes a specific AWS + GitHub setup that's typical for someone running multiple small apps from a personal AWS Organization. **None of the AWS-side setup is automated by the plugin** — the plugin uses it. Walk through each section below before running `/new-app` for the first time.

### 1. AWS Organization (one-time)

You need an AWS Organization with a management account you're the administrator of. The plugin creates a new **child account per app** so each app has its own billing line and blast radius.

**If you don't have an Organization yet:**

1. Sign into the AWS account you want to use as the management account.
2. Open **AWS Organizations** in the console: <https://console.aws.amazon.com/organizations>.
3. Click **Create an organization**. Pick **"Enable all features"** (not "Consolidated billing only") — full features are required for IAM Identity Center permission set assignments, which the plugin uses.
4. Confirm the verification email AWS sends to the management account's root email.

**If you already have one:** make sure it's in "All features" mode (Organizations → Settings). If it's still in "Consolidated billing only," upgrade — you can't downgrade later, but upgrading is one click.

You don't need to pre-create the child accounts; the plugin does that. But the **management account** itself must exist, and you must know its 12-digit account ID. Drop that into `aws.mgt_account_id` in your config (see [First-time setup](#first-time-setup) below).

### 2. IAM Identity Center (one-time)

The plugin signs you into each new child account via IAM Identity Center (formerly AWS SSO), not via IAM users. Identity Center needs to be enabled in the management account, with at least one user and one permission set.

**Enable Identity Center:**

1. Open <https://console.aws.amazon.com/singlesignon> while signed into the management account.
2. Click **Enable**. Pick a region — this is your "SSO region," distinct from the regions you deploy into. `us-east-1` is fine and common.
3. After enabling, note the **AWS access portal URL** at the top of the dashboard. It looks like `https://d-XXXXXXXXXX.awsapps.com/start`. That goes into `aws.sso_start_url` in your config.

**Create an admin permission set:**

1. In Identity Center, go to **Permission sets** → **Create permission set**.
2. Pick **Predefined permission set** → **AdministratorAccess**.
3. Name it `AdministratorAccess`. Accept defaults for session duration (1h is fine).

That name goes into `aws.sso_role_name` in your config. If you call it something else, set `aws.sso_role_name` accordingly — the `aws-account` skill looks the permission set up by name.

**Create your user:**

1. In Identity Center, go to **Users** → **Add user**.
2. Use your real email; pick a username (e.g. your handle).
3. After creating, AWS sends an invite to set a password.

**Assign yourself to the management account** (so you can `aws sso login --profile mgt`):

1. Go to **AWS accounts** → select the management account.
2. **Assign users or groups** → pick your user.
3. **Assign permission sets** → pick `AdministratorAccess`.
4. **Submit**.

You only do this once for the management account. After that, the `aws-account` skill assigns the same permission set to each new child account automatically — it discovers your principal by inspecting an existing assignment, so you never have to look up your Identity Center user ID by hand.

### 3. AWS CLI v2 + the `mgt` profile

Install AWS CLI v2 (not v1 — Identity Center support is v2 only):

```bash
brew install awscli
aws --version          # should print aws-cli/2.x
```

Add an entry to `~/.aws/config` for the management account. Substitute your real values:

```ini
[profile mgt]
sso_session = mgt
sso_account_id = <YOUR_MGT_ACCOUNT_ID>
sso_role_name = AdministratorAccess
region = us-east-1

[sso-session mgt]
sso_start_url = https://d-XXXXXXXXXX.awsapps.com/start
sso_region = us-east-1
sso_registration_scopes = sso:account:access
```

Test it:

```bash
aws sso login --profile mgt
aws sts get-caller-identity --profile mgt
```

The returned `Account` must equal your management account ID and the `Arn` must mention `AdministratorAccess`. The plugin's preflight skill verifies this same condition.

### 4. GitHub org + `gh` CLI

The plugin creates a private repo per app under a single GitHub organization (your `github.org` config value).

- The org must already exist. If you don't have one, create it at <https://github.com/account/organizations/new> (the free tier is fine for personal apps).
- You must be a member with `Owner` role (or any role that has repo-create permission).

Install and authenticate the GitHub CLI:

```bash
brew install gh
gh auth login              # pick GitHub.com, HTTPS, "Login with a web browser"
```

When asked for scopes, make sure `repo` and `admin:org` (or at least `write:org`) are granted — preflight will fail if they're missing. Verify:

```bash
gh auth status
gh api orgs/<your-org>/memberships/$(gh api user --jq .login) --jq '.role,.state'
```

The second command should print `admin` or `member` and `active`.

### 5. Local tooling

```bash
brew install mise jq        # version manager + JSON parser used by config-loading skills
brew install --cask claude  # if you don't already have Claude Code
```

Node and Python are managed by `mise` per-project (the generated `mise.toml` pins `node 24.14.0` and `python 3.12`). `npm` and `npx` ship with Node. `git` ships with macOS. `npx cdk` resolves on demand — no global CDK install required.

### 6. Optional: Route 53 billing (only if you want to register domains)

Domain registration is billable. The first time you register a domain, AWS will prompt for a credit card on file in the management account. Once it's set up, subsequent registrations are one-call.

You can skip this entirely — the plugin will happily serve apps from CloudFront default URLs (`d1234.cloudfront.net`) if you tell `/new-app` "no domain."

### 7. Optional: Bedrock model access (only if you select the LLM Lambda block)

The LLM Lambda template proxies Bedrock's Anthropic models. Bedrock requires a one-time, per-account **model access** opt-in:

1. After `/new-app` creates the child account, `aws sso login --profile child-<app>`.
2. Open <https://console.aws.amazon.com/bedrock/home#/modelaccess> in the child account.
3. Request access to the `Claude Haiku 4.5` model (or whatever the template references). Approval is usually instant.

The plugin can't do this for you — it's a console-only flow.

---

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
