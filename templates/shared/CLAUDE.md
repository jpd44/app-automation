# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

{{APP_DESCRIPTION}}

## Commands

```bash
npm run dev      # dev server
npm run build    # production bundle
npm run preview  # serve the production build locally (Vite only)
npm run lint     # type-check / lint
npm test         # run tests (if configured)
```

Node version: 24.14.0 (managed via mise — `mise install` to set up).

## Architecture

{{ARCHITECTURE_NOTES}}

## Conventions

- shadcn/ui primitives live in `src/components/ui/`; compose them rather than reaching for raw HTML or new UI libraries.
- Use `cn` from `src/lib/utils.ts` for conditional Tailwind classes.
- TypeScript is `strict`; `npm run lint` will fail on unused symbols.
- Path alias: `@/*` → `src/*`.

## Infrastructure

AWS deployment target: `AWS_PROFILE={{AWS_PROFILE}}`, region `us-east-1` (configured in `mise.toml`).

Stack lives in `cdk/`. Deploy with:

```bash
cd cdk && npm install && npx cdk deploy
```

The pipeline (`{{APP_NAME}}` in CodePipeline) pulls from `{{GITHUB_OWNER}}/{{APP_NAME}}` on push to `main`, runs lint + tests, then builds and syncs to S3 + invalidates CloudFront.
