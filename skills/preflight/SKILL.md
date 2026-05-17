---
description: Verify prerequisites before /new-app — config file present, AWS mgt session, GitHub auth + configured-org membership, and required local CLIs. Use whenever a workflow needs the user signed in or tools installed.
---

# /jpd-app-kit:preflight — verify auth and CLIs

Run **all checks**, collect failures, then print a single summary. Don't bail on the first failure — the user wants to fix everything in one pass.

## Load config first

Before any check, read `~/.config/jpd-app-kit/config.json`:

```bash
cat ~/.config/jpd-app-kit/config.json
```

If it doesn't exist, **fail with this message** and stop:

> Missing `~/.config/jpd-app-kit/config.json`. Copy `<plugin>/config.json.example` to that path and fill in your AWS management account ID, SSO start URL, GitHub org, and developer dir.

Extract these values for use throughout the checks:

- `aws.mgt_account_id`
- `aws.sso_start_url`
- `aws.sso_region` (default `us-east-1`)
- `aws.sso_role_name` (default `AdministratorAccess`)
- `github.org`
- `developer_dir` (and `developer_dir_symlinks[]`)

## Expected facts (from config)

| Thing | Source |
| --- | --- |
| AWS mgt account ID | `aws.mgt_account_id` |
| AWS region | `aws.default_region` |
| SSO start URL | `aws.sso_start_url` |
| GitHub org | `github.org` |
| Node | `24.14.0` (per `mise.toml`; any 22+ is workable) |

## Checks

Run these in parallel (one Bash call each) and capture exit codes + stdout/stderr.

### 0. Working directory — must be the Developer root

```bash
pwd
```

Pass if the resolved path matches `developer_dir` from config (after expanding `$HOME` / `~`) **or** any entry in `developer_dir_symlinks`. Use `readlink -f .` if ambiguous.

The whole `new-app` flow assumes the new project goes into `./<app-name>` from here. If `pwd` is anywhere else (e.g., inside an existing project, or under `~`), fail with:

> Run this from your Developer directory: `cd <developer_dir>` then re-run.

(substitute the actual configured path).

### A. Local CLIs present

```bash
command -v aws  >/dev/null && aws --version
command -v gh   >/dev/null && gh --version | head -1
command -v mise >/dev/null && mise --version
command -v node >/dev/null && node --version
command -v npm  >/dev/null && npm --version
command -v git  >/dev/null && git --version
command -v npx  >/dev/null && npx --version
```

If any is missing, the fix is `brew install aws-cli gh mise node git` (npm + npx ship with node).

### B. AWS — signed in to `mgt` and it's the right account

```bash
AWS_PROFILE=mgt aws sts get-caller-identity --output json
```

Pass conditions:
- exit code 0
- `Account` field equals `aws.mgt_account_id` from config
- `Arn` includes the configured `aws.sso_role_name` (default `AdministratorAccess`)

Common failures:
- Exit 255 + `Token has expired` → `aws sso login --profile mgt` (tell the user; don't run for them).
- `The config profile (mgt) could not be found` → user's `~/.aws/config` is missing the profile. Print the expected stanza, substituting the configured values:
  ```ini
  [profile mgt]
  sso_session = mgt
  sso_account_id = <aws.mgt_account_id>
  sso_role_name = <aws.sso_role_name>
  region = <aws.default_region>

  [sso-session mgt]
  sso_start_url = <aws.sso_start_url>
  sso_region = <aws.sso_region>
  sso_registration_scopes = sso:account:access
  ```

### C. AWS — Organizations API actually works from `mgt`

```bash
AWS_PROFILE=mgt aws organizations describe-organization --output json
```

Should return an org with `MasterAccountId` matching `aws.mgt_account_id` from config. If this fails with `AWSOrganizationsNotInUseException`, something is very wrong — stop and tell the user.

### D. GitHub — authed

```bash
gh auth status
```

Pass: exit 0 and output includes `Logged in to github.com`. Capture the active account name.

Failure fix: `gh auth login` (interactive; tell the user, don't run for them).

### E. GitHub — member of the configured org with repo-create permission

```bash
GH_ORG=$(jq -r .github.org ~/.config/jpd-app-kit/config.json)
gh api orgs/$GH_ORG/memberships/$(gh api user --jq .login) --jq '.role,.state'
```

Pass: `state == "active"` and `role` is `admin` or `member`. If 404, the user isn't a member of the org — stop, can't create repos there.

Also verify the token scope includes repo creation:
```bash
gh auth status -t 2>&1 | grep -i 'scopes'
```
Look for `repo` and `admin:org` (or at least `write:org`).

### F. CDK toolchain reachable

```bash
npx --yes cdk --version
```

Doesn't need to be installed globally — just needs npx to resolve it. If this hangs on first run, tell the user it's downloading.

## Output format

After all checks complete, print **one table** like this:

```
Preflight checks for jpd-app-kit

  Config file           [OK | MISSING ~/.config/jpd-app-kit/config.json]
  Working directory     [OK <path> | WRONG: <path>]
  Local CLIs            [OK | MISSING: <list>]
  AWS mgt session       [OK as <account-id> | EXPIRED | WRONG ACCOUNT: <got>]
  AWS Organizations     [OK | FAIL: <message>]
  GitHub auth           [OK as <user> | NOT LOGGED IN]
  GitHub <org> access   [OK (<role>) | NOT A MEMBER | MISSING SCOPE: <list>]
  CDK reachable         [OK v<version> | FAIL]

Result: READY  (or)  NEEDS ATTENTION — see fixes below
```

If anything failed, append a numbered "Fixes" section with the exact command(s) the user should run, in dependency order (CLIs first, then logins, then membership). Each fix lists who runs it (user vs. plugin), since SSO/gh logins must be done by the user interactively.

## When to call this skill

- **Always** as step 0 of `/jpd-app-kit:new-app`. If preflight returns `NEEDS ATTENTION`, stop the workflow — don't ask the app-name question yet, fixing prereqs first is cheaper than tearing down half-created resources.
- On demand via `/jpd-app-kit:preflight` if the user wants a standalone check.
