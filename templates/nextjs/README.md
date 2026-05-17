# Next.js stack notes

The CDK stack under `cdk/` is **identical to the Vite template** — same S3 + CloudFront + CodePipeline shape. The only differences live in app config:

1. **`next.config.ts`** must set `output: 'export'` so `npm run build` writes a static site to `out/` that the buildspec can sync to S3:
   ```ts
   import type { NextConfig } from "next";
   const nextConfig: NextConfig = { output: "export", images: { unoptimized: true } };
   export default nextConfig;
   ```

2. **`buildspec.yml`** uses `out/` as the build output directory (the `{{BUILD_OUTPUT_DIR}}` placeholder in `templates/shared/buildspec.yml` becomes `out`).

3. **Local dev port** is `3000`, not Vite's `5173` — adjust the Lambda CORS allowed origins accordingly when `needs_lambda` is true.

4. **No SSR / no API routes**. If you need them, this template isn't the right fit — fall back to the SAM setup used by `sites/www.munichmotoclub.com`.

5. **Auth wiring is not auto-scaffolded for Next.js.** The Vite template's `frontend/` bundle uses `amazon-cognito-identity-js` in shadcn forms; adapting it to the Next.js App Router means adding `"use client"` directives to the form components and wrapping the root layout with `<AuthProvider><AuthGuard>…</AuthGuard></AuthProvider>`. The CDK stack outputs (`VITE_USER_POOL_ID`, `VITE_USER_POOL_CLIENT_ID`, `VITE_API_URL`) are renamed `NEXT_PUBLIC_…` in the buildspec env so they're embedded at static-export time. If you pick Cognito on a Next.js app the orchestrator will copy the Vite components and stop with a note so you can finish the adaptation.
