---
description: Create a new child AWS account in the configured organization, assign the AdministratorAccess permission set via IAM Identity Center, and register a local SSO profile for it. Use when a new app needs an isolated AWS account.
---

# /jpd-app-kit:aws-account — provision a child account

## Load config first

Read `~/.config/jpd-app-kit/config.json`. You need:

- `aws.mgt_account_id`
- `aws.sso_start_url`
- `aws.sso_region`
- `aws.default_region`
- `aws.sso_role_name` (this is also the IAM Identity Center permission set name to assign, e.g., `AdministratorAccess`)
- `aws.account_email_template` (a string with `{app_name}` substitution, e.g., `you+{app_name}@example.com`)

If the file doesn't exist, stop and tell the user to copy `config.json.example` to `~/.config/jpd-app-kit/config.json`.

## Org facts (sourced from config)

- **Management account**: `mgt` profile, account ID = `aws.mgt_account_id`.
- **SSO instance**: `aws.sso_start_url`, region = `aws.sso_region`.
- **Permission set**: `aws.sso_role_name` — must already exist in IAM Identity Center.
- **Profile naming**: `child-<app-name>` for both the AWS profile and the SSO session.

## Steps

### 1. Inputs

`app_name` (kebab-case). The `account_email` is computed from the config template by substituting `{app_name}`, then confirmed with the user before submission. AWS requires the email to be unique across all of AWS.

### 2. Create the account — **confirm with user first**

```bash
AWS_PROFILE=mgt aws organizations create-account \
  --email "$ACCOUNT_EMAIL" \
  --account-name "child-$APP_NAME" \
  --role-name OrganizationAccountAccessRole \
  --iam-user-access-to-billing ALLOW
```

Capture the `CreateAccountRequestId`.

### 3. Poll until creation succeeds

```bash
AWS_PROFILE=mgt aws organizations describe-create-account-status \
  --create-account-request-id "$REQUEST_ID"
```

Loop with 15s sleeps, up to 5 min. Record the resulting `AccountId` into `$NEW_ACCOUNT_ID`.

### 4. Assign the permission set via IAM Identity Center

A fresh child account has the `OrganizationAccountAccessRole` from step 2 (assumable only from `mgt`) but **no IAM Identity Center permission set assignment**. Without this step, `aws sso login --profile child-<app>` would fail with no roles to assume. Add the assignment.

**4a. Get the Identity Center instance ARN and identity store ID** (one-time per session — cache the values):

```bash
read -r INSTANCE_ARN ID_STORE_ID < <(
  AWS_PROFILE=mgt aws sso-admin list-instances \
    --query 'Instances[0].[InstanceArn,IdentityStoreId]' --output text
)
```

**4b. Find the permission set ARN by name** (`$PERMISSION_SET_NAME` = `aws.sso_role_name` from config, typically `AdministratorAccess`):

```bash
PERMISSION_SET_ARN=$(
  for arn in $(AWS_PROFILE=mgt aws sso-admin list-permission-sets \
    --instance-arn "$INSTANCE_ARN" --query 'PermissionSets[]' --output text); do
    name=$(AWS_PROFILE=mgt aws sso-admin describe-permission-set \
      --instance-arn "$INSTANCE_ARN" --permission-set-arn "$arn" \
      --query 'PermissionSet.Name' --output text)
    if [ "$name" = "$PERMISSION_SET_NAME" ]; then echo "$arn"; break; fi
  done
)
```

If `$PERMISSION_SET_ARN` is empty, **stop and tell the user**: the permission set named `$PERMISSION_SET_NAME` doesn't exist in Identity Center. They'd need to create it in the console (or via `aws sso-admin create-permission-set`) before re-running.

**4c. Discover the principal to assign**

Pull it from an existing child account's assignment to match the pattern the user already uses. Find an existing child account (anything in `aws organizations list-accounts` other than `mgt`), then:

```bash
read -r PRINCIPAL_TYPE PRINCIPAL_ID < <(
  AWS_PROFILE=mgt aws sso-admin list-account-assignments \
    --instance-arn "$INSTANCE_ARN" \
    --account-id "$EXISTING_CHILD_ACCOUNT_ID" \
    --permission-set-arn "$PERMISSION_SET_ARN" \
    --query 'AccountAssignments[0].[PrincipalType,PrincipalId]' --output text
)
```

If no existing child accounts exist (this is the very first child), prompt the user for their Identity Center user ID:
```bash
AWS_PROFILE=mgt aws identitystore list-users \
  --identity-store-id "$ID_STORE_ID" \
  --query 'Users[].[UserName,UserId]' --output table
```
Then ask the user to pick a `UserName`, and use the corresponding `UserId` as `$PRINCIPAL_ID` with `$PRINCIPAL_TYPE=USER`.

**4d. Create the assignment**

```bash
ASSIGNMENT_REQUEST_ID=$(
  AWS_PROFILE=mgt aws sso-admin create-account-assignment \
    --instance-arn "$INSTANCE_ARN" \
    --target-id "$NEW_ACCOUNT_ID" \
    --target-type AWS_ACCOUNT \
    --permission-set-arn "$PERMISSION_SET_ARN" \
    --principal-type "$PRINCIPAL_TYPE" \
    --principal-id "$PRINCIPAL_ID" \
    --query 'AccountAssignmentCreationStatus.RequestId' --output text
)
```

**4e. Poll until the assignment is `SUCCEEDED`**

```bash
AWS_PROFILE=mgt aws sso-admin describe-account-assignment-creation-status \
  --instance-arn "$INSTANCE_ARN" \
  --account-assignment-creation-request-id "$ASSIGNMENT_REQUEST_ID" \
  --query 'AccountAssignmentCreationStatus.Status' --output text
```

Loop with 10s sleeps, up to 2 min. Typical completion is under 30s. If status becomes `FAILED`, fetch the same response with `--query 'AccountAssignmentCreationStatus.FailureReason'` and surface it to the user.

### 5. Append the SSO profile to `~/.aws/config`

Do not overwrite, append. Substitute config values:

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

### 6. Tell the user to run `aws sso login --profile child-<app-name>`

Do not run it yourself — it opens a browser and requires their interactive consent.

### 7. Verify

Once they confirm login:

```bash
AWS_PROFILE=child-<app-name> aws sts get-caller-identity
```

Confirm the account ID matches `$NEW_ACCOUNT_ID` and the `Arn` includes the permission set name.

## Things to skip

- Don't create IAM users. Identity Center permission set + the assignment above is the whole auth story.
- Don't try to enable IAM Identity Center itself — the user already has it (we discovered the instance ARN in step 4a). Setup is a one-time, console-only operation.
- Don't add the same principal twice. If `list-account-assignments` already shows the user/group on the new account, skip step 4d — `create-account-assignment` would otherwise return `ConflictException`.
- **Do NOT run `aws sso logout`** to force a credential refresh after the assignment lands. `aws sso logout` clears the OIDC token for *every* AWS profile that shares the same SSO instance — the user would then have to re-authenticate on every profile they use. The role credentials for the new profile pick up the freshly-assigned permission set automatically on the next API call; if you really need to force a refresh, just delete `~/.aws/sso/cache/<hash>.json` for the specific profile, not the OIDC token.
