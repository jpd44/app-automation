---
description: Render the CDK stack template into a new app's cdk/ directory, bootstrap the child account, and run the first deploy. Use when a new app needs its S3+CloudFront+CodePipeline infrastructure.
---

# /jpd-app-kit:cdk-stack — render and deploy infra

This mirrors `daily-deutsch/cdk/`: S3 (private, OAC) → CloudFront (apex + www, ACM, www-to-apex redirect, SPA error rewrite) → Route 53 alias records → CodeStar GitHub connection → CodeBuild test + CodeBuild build/deploy → CodePipeline V2 with Source/Test/BuildAndDeploy stages.

## Inputs

From the orchestrator: `app_name`, `aws_account_id`, `github_owner` (defaults to `github.org` from config), `github_branch` (defaults `main`), `domain` (string OR null), and **three independent toggles**:

- `needs_cognito` (bool) — adds Cognito UserPool + UserPoolClient
- `needs_api` (bool) — adds HTTP API Gateway + JWT authorizer + sample protected Lambda. Requires `needs_cognito=true`; refuse otherwise.
- `needs_llm_lambda` (bool) — adds the daily-deutsch-style unauth'd Bedrock Lambda Function URL

If `domain` is null the app is served from the CloudFront default URL only (no Route 53, no ACM cert, no www→apex redirect).

## Steps

### 1. Copy the template

Pick `templates/vite/cdk/` or `templates/nextjs/cdk/` based on the user's stack choice. Copy into `<app-path>/cdk/`. **Rename `lib/stack.ts` to `lib/<app-name>-stack.ts`** (the import in `bin/app.ts` expects this). Then walk the tree and replace placeholders:

| Placeholder | Replacement |
| --- | --- |
| `{{APP_NAME}}` | kebab-case (`daily-deutsch`) |
| `{{APP_NAME_PASCAL}}` | PascalCase (`DailyDeutsch`) |
| `{{DOMAIN}}` | apex (`daily-deutsch.com`) |
| `{{AWS_ACCOUNT_ID}}` | child account ID |
| `{{GITHUB_OWNER}}` | `github.org` from config unless overridden |
| `{{GITHUB_BRANCH}}` | usually `main` |

**Strip the blocks the user didn't pick.** The template has these block-pair markers in `lib/<app-name>-stack.ts` and `bin/app.ts`. Block-pair stripping = delete everything from the `// BEGIN_X` line through the matching `// END_X` line, inclusive.

| Condition | Markers to **keep** | Markers to **strip** |
| --- | --- | --- |
| `domain` is a string | `BEGIN_DOMAIN` / `END_DOMAIN` | `BEGIN_NO_DOMAIN` / `END_NO_DOMAIN` |
| `domain` is null | `BEGIN_NO_DOMAIN` / `END_NO_DOMAIN` | `BEGIN_DOMAIN` / `END_DOMAIN` |
| `needs_llm_lambda=false` | — | `BEGIN_LLM_LAMBDA` / `END_LLM_LAMBDA` (all occurrences). Also delete `lambda/llm/` directory. |
| `needs_cognito=false` | — | `BEGIN_COGNITO` / `END_COGNITO` (all occurrences). |
| `needs_api=false` | — | `BEGIN_API` / `END_API` (all occurrences). Also delete `lambda/hello-protected/` directory. |

**Important: `DOMAIN` and `NO_DOMAIN` are an XOR pair.** Exactly one must remain in the rendered file. If both stay, you'll get `Identifier 'allowedOrigins' has already been declared` from TypeScript. If neither stays, the file won't compile because `allowedOrigins` is referenced.

**Constraint enforcement:** if `needs_api=true` and `needs_cognito=false`: refuse and tell the user the API authorizer depends on the user pool. Don't try to build a stack that won't synth.

If the stack is Next.js, change `http://localhost:5173` to `http://localhost:3000` in whichever `allowedOrigins` block survived.

### 2. Install CDK deps

```bash
cd <app-path>/cdk
npm install
```

If `needs_api=true`, also install the apigatewayv2 modules — they may not auto-resolve depending on the CDK version:
```bash
npm install @aws-sdk/client-cognito-identity-provider
```

If the apigatewayv2 imports fail to resolve at `cdk synth` time, the user is on an older CDK where the v2 modules are still in alpha — install them and switch imports:
```bash
npm install @aws-cdk/aws-apigatewayv2-alpha @aws-cdk/aws-apigatewayv2-authorizers-alpha @aws-cdk/aws-apigatewayv2-integrations-alpha
```
Update the three imports at the top of `lib/<app>-stack.ts` accordingly.

### 2b. Frontend auth wiring (when `needs_cognito=true`)

For the **Vite** stack, copy from `templates/vite/frontend/`:

| Template file | Destination |
| --- | --- |
| `lib/auth.ts` | `<app>/src/lib/auth.ts` |
| `lib/api.ts` | `<app>/src/lib/api.ts` (only if `needs_api=true`) |
| `components/AuthProvider.tsx` | `<app>/src/components/AuthProvider.tsx` |
| `components/AuthGuard.tsx` | `<app>/src/components/AuthGuard.tsx` |
| `components/SignInForm.tsx` | `<app>/src/components/SignInForm.tsx` |
| `components/SignUpForm.tsx` | `<app>/src/components/SignUpForm.tsx` |
| `components/ConfirmSignUpForm.tsx` | `<app>/src/components/ConfirmSignUpForm.tsx` |
| `.env.example` | `<app>/.env.example` (merge if one already exists) |

Then in the new app's root:
```bash
cd <app-path>
npm install amazon-cognito-identity-js
npx shadcn@latest add button input label card
```

Edit `src/App.tsx` to wrap the existing root in `<AuthProvider><AuthGuard>…</AuthGuard></AuthProvider>` (imports from `@/components/AuthProvider` and `@/components/AuthGuard`). If `App.tsx` is non-trivial, show the diff and confirm with the user before writing.

For the **Next.js** stack, **don't auto-copy the components** — they need `"use client"` directives and a layout-level wrapper. Print a note pointing the user to `templates/vite/frontend/` as a starting point and the instructions in `templates/nextjs/README.md`.

### 3. Bootstrap the child account (idempotent)

```bash
AWS_PROFILE=child-<app-name> npx cdk bootstrap aws://<account-id>/us-east-1
```

### 4. Synth — **show the user the diff before deploying**

```bash
AWS_PROFILE=child-<app-name> npx cdk synth
AWS_PROFILE=child-<app-name> npx cdk diff
```

Summarize the resources to be created and **wait for explicit OK** before the next step.

### 5. Deploy

```bash
AWS_PROFILE=child-<app-name> npx cdk deploy --require-approval broadening
```

`broadening` (vs `never` or `any-change`) only prompts when IAM permissions widen — matches the daily-deutsch cadence.

### 6. Post-deploy

- Print the `AuthorizeConnectionUrl` CloudFormation output. **The user must click through this and authorize the GitHub app** before the pipeline can pull source. The connection sits in `PENDING` until they do.
- Print every applicable output: `SiteUrl`, `DistributionId`, `BucketName`, plus `LlmUrl` / `UserPoolId` + `UserPoolClientId` / `ApiUrl` depending on toggles. The build project already has these wired into its env vars; no manual export needed for CI builds.
- If `needs_cognito=true`, write a `.env.local` in the app root with `VITE_AWS_REGION`, `VITE_USER_POOL_ID`, `VITE_USER_POOL_CLIENT_ID`, and (if `needs_api`) `VITE_API_URL` filled from the CloudFormation outputs, so local dev works immediately.
- If `domain` is null, the `SiteUrl` output will be the CloudFront default domain (e.g., `https://d1234.cloudfront.net`). Print it to the user and note that they can later attach a real domain by pasting the `BEGIN_DOMAIN` block markers back in and uncommenting their `bin/app.ts` `domainName` prop.
- Tell the user to push any change to `main` to trigger the first end-to-end pipeline run.

## Troubleshooting cribs

- `Cannot find module 'aws-cdk-lib'` → forgot `npm install` in `cdk/`.
- `User is not authorized to perform: sts:AssumeRole` on bootstrap → SSO token expired; `aws sso login --profile child-<app-name>`.
- `Cert validation pending forever` → the hosted zone isn't actually delegated yet (the `domain` skill's step 5 wasn't completed). Validation will sit until the registrar's NS records point at the child zone.
- CodePipeline source action stuck → CodeStar connection wasn't authorized. Re-open `AuthorizeConnectionUrl`.
