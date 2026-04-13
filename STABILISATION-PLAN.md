# Engineering Stabilisation Plan

**Project:** Creative Kitchen Static
**Audited:** April 13 2026
**Stack:** Vite + React + Supabase (EU Central, ref: ifrxylvoufncdxyltgqt) + Vercel
**Repo:** github.com/willagpt/creative-kitchen-static
**Live URL:** https://creative-kitchen-static.vercel.app
**Asana:** [Engineering Stabilisation project](https://app.asana.com/1/5717506944667/project/1214024873723525)

## Summary

The app works and is deployed, but 13 of 14 Supabase edge functions exist only on the platform with no source in the repo. A previous stabilisation plan was created (17 Asana tasks) and 13 were marked complete, but the repo doesn't reflect most of that work: no CI pipeline, no env var management, and only 1 edge function in the correct repo path. The immediate priority is getting edge function source code into version control before it's lost.

## P0: Must fix before next feature work

- [ ] **Export all edge functions to supabase/functions/**
  - What: 13 of 14 deployed edge functions have no source in supabase/functions/. 2 others are in chrome-extension/supabase-edge-function/ (non-standard path).
  - Why: If anyone redeploys from the repo, these functions vanish. They include the core analysis pipeline (analyse-competitor-creatives at v25, process-analysis-batch at v16) and prompt generation (generate-ad-prompt at v26).
  - How: For each function, use `supabase functions download <slug>` or retrieve via Supabase dashboard. Place in `supabase/functions/<slug>/index.ts`. Move the 2 chrome-extension copies to supabase/functions/ as well.
  - Files: Create supabase/functions/{slug}/index.ts for: analyse-competitor-creatives, process-analysis-batch, fetch-competitor-ads, describe-photo, extract-ad-thumbnails, generate-variables, extract-brand-guidelines, refine-prompt, compare-prompts, vision-model-test, seed-advertisers. Move generate-ad-prompt and templatize-prompt from chrome-extension/supabase-edge-function/.
  - Scope: Medium (downloading + committing 14 files, verifying they match deployed versions)
  - Asana: [Export all 13 Supabase edge functions to GitHub repo](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214025669951436) (reopened)

- [ ] **Create CLAUDE.md**
  - What: No context file existed for future sessions.
  - Why: Every new AI session or developer starts blind.
  - How: DONE. Committed to .claude/CLAUDE.md on April 13 2026.
  - Scope: Complete
  - Asana: [Create CLAUDE.md](task preview created, confirm in Asana)

- [ ] **Move hardcoded credentials to environment variables**
  - What: src/lib/supabase.js and src/lib/supabase-v3.js hardcode Supabase URL and anon key.
  - Why: Can't switch environments without editing source. Also makes credential rotation impossible without a code change.
  - How: Replace hardcoded values with `import.meta.env.VITE_SUPABASE_URL` etc. Create .env.example documenting all required variables. Set values in Vercel dashboard.
  - Files: src/lib/supabase.js, src/lib/supabase-v3.js, new .env.example
  - Scope: Small
  - Asana: [Set up environment variable management](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214026444701517) (reopened)

## P1: Fix within the next sprint

- [ ] **Set up GitHub Actions CI**
  - What: No .github/workflows/ directory. No build checks on push or PR.
  - Why: Broken imports and build errors only caught by Vercel after push to main.
  - How: Add .github/workflows/ci.yml with npm ci + npm run build on push to main and PRs.
  - Files: .github/workflows/ci.yml (new)
  - Scope: Small
  - Asana: [Set up GitHub Actions CI/CD](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214024873727901) + [Add Vite build check](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214025669958856) (both reopened)

- [ ] **Enable RLS on foreplay_credit_log and brand_guidelines**
  - What: 2 of 29 tables have RLS disabled.
  - Why: Without RLS, any authenticated user (or anyone with the anon key) can read/write these tables.
  - How: Add RLS policies matching the workspace-scoped pattern used by the other 27 tables.
  - Files: Database migration
  - Scope: Small
  - Asana: [Add Supabase RLS policies for all tables](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214030739143192) (existing, updated with specifics)

- [ ] **Remove dead code (3,275 lines)**
  - What: 4 files not imported or used anywhere.
  - Why: Confusing (which CompetitorAds is real?), inflates codebase, wastes context in AI sessions.
  - How: Delete src/CompetitorAds.jsx (1,292 lines), src/CompetitorAds.css (836 lines), competitor-ads.html in root (1,147 lines), src/lib/supabase-v3.js (8 lines).
  - Files: 4 files to delete
  - Scope: Small
  - Asana: Task preview created, confirm in Asana

- [ ] **Sync local Google Drive files with GitHub repo**
  - What: Some project files may exist on Google Drive but not in the repo.
  - Why: Files outside git are invisible to CI and other developers.
  - How: Check Google Drive for any project files, commit relevant ones to repo.
  - Scope: Medium
  - Asana: [Sync local Google Drive files with GitHub repo](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214022124030384) (existing)

## P2: Improve when convenient

- [ ] **Break up CompetitorAds.jsx (2,369 lines)**
  - Scope: Large
  - Asana: [Break up CompetitorAds.jsx](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214025669959014) (existing)

- [ ] **Refactor gallery.js Chrome extension (567 lines)**
  - Scope: Medium
  - Asana: [Refactor gallery.js](https://app.asana.com/1/5717506944667/project/1214024873723525/task/1214025669952040) (existing)

- [ ] **Split CompareAnalyses.jsx (1,018 lines)**
  - Scope: Medium
  - Asana: Task preview created, confirm in Asana

- [ ] **Split Launcher.jsx (887 lines)**
  - Scope: Medium
  - Asana: Not yet created

## CLAUDE.md Updates Required

- [x] Created .claude/CLAUDE.md with full architecture, tables, edge functions, and conventions

## Audit Metadata

- Total findings: 13
- P0: 3 | P1: 4 | P2: 4
- Asana tasks reopened: 4 (edge functions, CI/CD, Vite build check, env vars)
- Asana tasks created: 3 (CLAUDE.md, dead code removal, CompareAnalyses split)
- Estimated P0 remediation: 1 to 2 sessions
- Estimated total remediation: 3 to 4 sessions
