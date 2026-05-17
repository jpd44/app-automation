# Frontend auth bundle

These files get copied into the new app's `src/` when **Cognito** is selected in `/jpd-app-kit:new-app`. They wire up Cognito user pools to a shadcn-based sign-in/sign-up UI and provide an `apiFetch` helper that attaches the user's ID token to every protected request.

## What gets copied where

| Template file | Destination in the new app |
| --- | --- |
| `lib/auth.ts` | `src/lib/auth.ts` |
| `lib/api.ts` | `src/lib/api.ts` (only if HTTP API block was also picked) |
| `components/AuthProvider.tsx` | `src/components/AuthProvider.tsx` |
| `components/AuthGuard.tsx` | `src/components/AuthGuard.tsx` |
| `components/SignInForm.tsx` | `src/components/SignInForm.tsx` |
| `components/SignUpForm.tsx` | `src/components/SignUpForm.tsx` |
| `components/ConfirmSignUpForm.tsx` | `src/components/ConfirmSignUpForm.tsx` |
| `.env.example` | `.env.example` (merge with any existing file) |

## Required npm deps (the orchestrator installs these)

```bash
npm i amazon-cognito-identity-js
```

## Required shadcn primitives

```bash
npx shadcn@latest add button input label card
```

## Wiring it into `App.tsx`

The orchestrator inserts this snippet (or prompts before editing if `App.tsx` is non-trivial):

```tsx
import { AuthProvider } from "@/components/AuthProvider";
import { AuthGuard } from "@/components/AuthGuard";

export default function App() {
  return (
    <AuthProvider>
      <AuthGuard>
        {/* your existing app */}
      </AuthGuard>
    </AuthProvider>
  );
}
```

## Hitting the protected `/hello` endpoint

```tsx
import { apiFetch } from "@/lib/api";

const data = await apiFetch<{ message: string; sub: string }>("/hello");
```

`apiFetch` reads `VITE_API_URL`, grabs the current ID token via `getIdToken()`, and rejects with `ApiError(401)` if the user isn't signed in. The Lambda gets the user's claims via `event.requestContext.authorizer.jwt.claims`.

## Local dev

After the first `cdk deploy`, copy `.env.example` to `.env.local` and fill in the values from CloudFormation outputs:

```bash
AWS_PROFILE=child-<app> aws cloudformation describe-stacks --stack-name <Pascal>Stack \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId` || OutputKey==`UserPoolClientId` || OutputKey==`ApiUrl`]'
```
