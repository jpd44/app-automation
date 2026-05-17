---
description: Create a private GitHub repo under the configured org, push the initial commit, and configure default branch + branch protection.
---

# /jpd-app-kit:github-repo — private repo under the configured org

## Load config first

```bash
GH_ORG=$(jq -r .github.org ~/.config/jpd-app-kit/config.json)
```

## Prereqs

- `gh` CLI installed and authed (`gh auth status`). If not, tell the user to run `gh auth login` — don't try to do it for them.
- User is a member of `$GH_ORG` with repo-create permission.

## Steps

1. **Sanity-check** there isn't already a repo with this name:
   ```bash
   gh repo view $GH_ORG/<app-name> 2>&1 | head -1
   ```
   If it exists, **stop and ask the user** whether to reuse it or pick a new name. Do not delete.

2. **Initial commit** in the local repo (created by `new-app` scaffold step):
   ```bash
   cd <app-path>
   git add .
   git commit -m "Initial commit from jpd-app-kit"
   ```

3. **Create the repo** and push:
   ```bash
   gh repo create $GH_ORG/<app-name> \
     --private \
     --source . \
     --remote origin \
     --description "<app description from user, or leave blank>" \
     --push
   ```

4. **Default branch** to `main` (gh respects local default, but verify):
   ```bash
   gh repo edit $GH_ORG/<app-name> --default-branch main
   ```

5. **No branch protection by default** — the existing repos in this org (e.g., `daily-deutsch`, `munichmotoclub`) don't use it and adding it would block the CodePipeline auto-merges the user may rely on. If the user wants protection, they'll ask.

6. **Print the repo URL** so the user can visit it.

## What NOT to do

- Don't push secrets. Inspect `git status` before staging if the local scaffold may have written `.env` or `*.pem` files.
- Don't create a GitHub Actions workflow — deployment runs through CodePipeline, not Actions, in this setup.
