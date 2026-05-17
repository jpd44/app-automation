---
description: Create a new child AWS account in the configured organization and register a local SSO profile for it. Use when a new app needs an isolated AWS account.
---

# /jpd-app-kit:aws-account — provision a child account

## Load config first

Read `~/.config/jpd-app-kit/config.json`. You need:

- `aws.mgt_account_id`
- `aws.sso_start_url`
- `aws.sso_region`
- `aws.default_region`
- `aws.sso_role_name`
- `aws.account_email_template` (a string with `{app_name}` substitution, e.g., `you+{app_name}@example.com`)

If the file doesn't exist, stop and tell the user to copy `config.json.example` to `~/.config/jpd-app-kit/config.json`.

## Org facts (sourced from config)

- **Management account**: `mgt` profile, account ID = `aws.mgt_account_id`.
- **SSO instance**: `aws.sso_start_url`, region = `aws.sso_region`.
- **Role**: `aws.sso_role_name` (the default role pushed to every child account by the org).
- **Profile naming**: `child-<app-name>` for both the AWS profile and the SSO session.

## Steps

1. **Inputs**: `app_name` (kebab-case). The `account_email` is computed from the config template by substituting `{app_name}`, then confirmed with the user before submission. AWS requires the email to be unique across all of AWS.

2. **Confirm with user** the email and account alias. Then create:
   ```bash
   AWS_PROFILE=mgt aws organizations create-account \
     --email "$ACCOUNT_EMAIL" \
     --account-name "child-$APP_NAME" \
     --role-name OrganizationAccountAccessRole \
     --iam-user-access-to-billing ALLOW
   ```
   Capture the `CreateAccountRequestId`.

3. **Poll** until status is `SUCCEEDED`:
   ```bash
   AWS_PROFILE=mgt aws organizations describe-create-account-status \
     --create-account-request-id "$REQUEST_ID"
   ```
   Loop with 15s sleeps, up to 5 min. Record the resulting `AccountId`.

4. **Append to `~/.aws/config`** — do not overwrite, append. Substitute config values into this template:
   ```ini
   [profile child-{{APP_NAME}}]
   sso_session = child-{{APP_NAME}}
   sso_account_id = {{ACCOUNT_ID}}
   sso_role_name = {{aws.sso_role_name}}
   region = {{aws.default_region}}

   [sso-session child-{{APP_NAME}}]
   sso_start_url = {{aws.sso_start_url}}
   sso_region = {{aws.sso_region}}
   sso_registration_scopes = sso:account:access
   ```

5. **Tell the user to run** `aws sso login --profile child-<app-name>`. Do not run it yourself — it opens a browser and requires their interactive consent.

6. **Verify**: once they confirm login, run
   ```bash
   AWS_PROFILE=child-<app-name> aws sts get-caller-identity
   ```
   and confirm the account ID matches.

## Things to skip

- Don't try to enable IAM Identity Center or assign permission sets — the org already auto-pushes `AdministratorAccess`. Just wait a minute or two after account creation for SSO propagation.
- Don't create IAM users. SSO + the role above is the whole auth story.
