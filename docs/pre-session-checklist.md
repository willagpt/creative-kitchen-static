# Pre-Session Checklist — Creative Kitchen Static

Run this at the start of every working session. Takes 2 minutes. Prevents 2 hours of debugging.

## Before Writing Any Code

1. **Identify scope** — What files will this session touch? List them.
2. **Check Asana** — Is there a ticket for this work? If not and it touches >1 file, create one first. (Project: Creative Kitchen — Engineering Stabilisation)
3. **Verify GitHub is current** — Are the files you're about to edit in the GitHub repo (willagpt/creative-kitchen-static)? Do they match what's deployed?
4. **Check Vercel deployment** — What's the latest commit deployed at creative-kitchen-static.vercel.app? Does it match the HEAD of main?
5. **Check edge function versions** — If touching edge functions, verify the deployed version on Supabase matches what's in supabase/functions/{slug}/index.ts in the repo.

## While Working

6. **One change at a time** — Commit after each logical change, not in one big batch at the end.
7. **Edge functions: commit to GitHub FIRST, then deploy from repo** — Never deploy directly to Supabase from ad-hoc code.
8. **Test before pushing to main** — Run npm run build locally. Check for console errors.

## Before Ending Session

9. **Update CLAUDE.md** if any new edge functions, tables, or architectural decisions were made.
10. **Update code state matrix** (docs/code-state-matrix.md) if deployed versions changed.
11. **Update Asana** — Mark tasks complete, add comments documenting what was done.
12. **Verify deployment** — Check that creative-kitchen-static.vercel.app reflects the changes.

## Red Flags — Stop and Verify

- You can't find a file locally that should exist → Check GitHub, it's the source of truth
- Edge function version in Supabase doesn't match repo → DO NOT deploy. Investigate first.
- You're about to edit a file >500 lines → Consider whether it should be refactored first
- A "quick fix" is turning into changes across 3+ files → Stop. Create an Asana ticket. Plan it.
