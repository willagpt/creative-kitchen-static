# Branching Strategy — Creative Kitchen Static

## Branches

| Branch | Purpose | Deploys to | Protected |
|---|---|---|---|
| `main` | Production | Vercel (auto-deploy) + Supabase edge functions (via GitHub Actions) | Yes — no direct pushes |
| `dev` | Integration/staging | Nothing (manual testing only) | No |
| `feature/*` | Individual features/fixes | Nothing | No |

## Workflow

1. **Create a feature branch** from `dev`: `feature/add-pot-packaging-support`
2. **Work on the feature branch** — commit frequently, one logical change per commit
3. **Open a PR** from `feature/*` → `dev` — build check runs automatically
4. **Merge to dev** — test manually, verify nothing's broken
5. **Open a PR** from `dev` → `main` — build check runs, edge function deploy triggers on merge
6. **Delete the feature branch** after merge

## Naming Conventions

- `feature/short-description` — new functionality
- `fix/short-description` — bug fixes
- `docs/short-description` — documentation only
- `refactor/short-description` — code cleanup with no behavior change

## Rules

- **Never push directly to main.** Always go through dev → main PR.
- **Never deploy edge functions outside this flow.** The GitHub Action handles deployment.
- **Every PR to main must pass the build check.**
- **Multi-file changes need an Asana ticket** in "Creative Kitchen — Engineering Stabilisation" before work starts.

## For AI Sessions (Claude/Cowork)

When working in an AI session:
1. Create a feature branch: `feature/session-description`
2. Make all changes on that branch
3. Push to GitHub
4. Open PR to dev (or main if it's a hotfix)
5. The human reviews and merges

This prevents AI sessions from accidentally pushing breaking changes directly to production.
