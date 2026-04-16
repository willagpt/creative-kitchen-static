# Branching Strategy and CI

Adopted 16 April 2026 as part of Phase 2 engineering stabilisation.

## Branches

- **`main`** → production. Auto-deploys to Vercel (`creative-kitchen-static.vercel.app`). Supabase edge-function deploys fire from pushes to this branch only.
- **`develop`** → integration branch. Vercel generates a preview deploy for every push. Use this as the merge target for ongoing feature work.
- **`feature/*`** → short-lived branches off `develop`. One scope per branch.
- **`hotfix/*`** → short-lived branches off `main` for urgent production fixes. Merge straight back to `main`, then rebase `develop`.

Legacy branches (`dev`, `master`, `v1`) are scheduled for deletion once the active PR (#1) from `dev` is resolved. Do not start new work on them.

## Flow

```
feature/<scope>  →  PR  →  develop  →  PR  →  main
                                 ↑               ↓
                         Vercel preview   Vercel prod + edge deploys
```

Hotfixes:

```
hotfix/<scope>  →  PR  →  main
                              ↓
            (rebase develop on main afterwards)
```

## CI workflows

Source: `.github/workflows/`.

- **`ci.yml`** → runs on push to `main` + `develop` and on PRs targeting either. Installs dependencies, runs `npm run build` with placeholder Supabase env vars to confirm the Vite build is clean. Concurrency guard cancels superseded runs on the same ref.
- **`deploy-edge-functions.yml`** → runs only on push to `main` when files under `supabase/functions/**` change. Deploys the affected functions via the Supabase CLI using `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` secrets.

There is no test runner yet. Adding lint + unit tests is Phase 3 engineering work.

## Expected check on every PR

1. `CI / Build` must pass.
2. PR must have a plain-English description of the change.
3. Multi-file changes should link to an Asana ticket in the engineering project.

## Branch protection (pending)

Branch protection rules must be added through the GitHub UI, they cannot be managed via MCP today. Target state:

- `main`: require PR, require `CI / Build` to pass, disallow force-push, require linear history, require at least one review (self-approval OK while team size is 1).
- `develop`: require `CI / Build` to pass, allow squash merges from feature branches.

An Asana ticket tracks this as a user-UI follow-up.

## Vercel preview deploys

Vercel automatically builds a preview for every branch and PR against the connected repository. The preview URL for `develop` is stable; feature-branch previews are per-branch. No extra config needed.
