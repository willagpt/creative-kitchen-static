# Environment Variable Setup

## Required GitHub Secrets

Set these in GitHub repo Settings → Secrets and variables → Actions:

| Secret | Description | Where to find it |
|---|---|---|
| `SUPABASE_PROJECT_REF` | Supabase project reference ID | `ifrxylvoufncdxyltgqt` (Dashboard → Settings → General) |
| `SUPABASE_ACCESS_TOKEN` | Personal access token for Supabase CLI | Generate at https://supabase.com/dashboard/account/tokens |

## Vercel (auto-configured)

Vercel auto-deploys from the `main` branch. No secrets needed in GitHub — Vercel handles its own connection.

## Edge Function Secrets (Supabase Dashboard)

These are set in Supabase Dashboard → Edge Functions → Manage secrets:

| Secret | Description |
|---|---|
| `CLAUDE_API_KEY` | Anthropic API key for Claude Opus 4.6 calls |
| `SUPABASE_URL` | Auto-set by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-set by Supabase |
| `SUPABASE_ANON_KEY` | Auto-set by Supabase |

## Local Development

Create `.env.local` (gitignored) with:
```
VITE_SUPABASE_URL=https://ifrxylvoufncdxyltgqt.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
```

**NEVER commit API keys to the repo.**
