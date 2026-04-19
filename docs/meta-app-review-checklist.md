# Meta App Review Checklist: Ads Archive API

**Status (19 Apr 2026):** App review pending. The `fetch-competitor-ads` edge function ships with the Meta fallback gated off behind `META_AD_LIBRARY_ENABLED` (default `false`). Once Meta approves the app, flip the flag to `true` and the function will start using `/ads_archive` automatically. No code change required.

## Why This Is Needed

When Foreplay has zero coverage for a brand (which happens regularly for non-Simmer brands the user adds via the "Add Competitor" modal), we want to fall back to Meta's official Ad Library API (`GET /v23.0/ads_archive`).

That endpoint requires **app-level review approval** for the "Ads Archive API" use case. Without it, every call returns:

```
Application does not have permission for this action
  code: 200
  subcode: 2332002 (or 2332004 with an app access token)
```

The error is **independent of token type**. We have already verified this with:

- Long-lived user token (60 days)
- Page access token (never expires)
- App access token in `{APP_ID}|{APP_SECRET}` form (PR #44, never expires but limited to political/electoral ads)
- Business Manager System User token (PR #45, carries user-context perms)

All four return the same subcode 2332002/2332004. The fix is app review, not a different token.

## What's In Place

- **Edge function gate:** `META_AD_LIBRARY_ENABLED` env var on `fetch-competitor-ads` controls whether the Meta API call is attempted. Default `false`.
- **Direct link UX:** When the gate is off (or no token is available), the `Add Competitor` modal renders a clickable "Open in Meta Ad Library →" link to `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=GB&view_all_page_id={PAGE_ID}`. The user can scrape brand ads manually until the API is unlocked.
- **Tokens stored, ready to use:** `META_APP_ID`, `META_APP_SECRET`, `META_SYSTEM_USER_TOKEN` are already set as Supabase secrets. Once Meta approves the app, no token rotation is needed.

## App Review Submission Steps

The submission lives in the Meta Developer dashboard for app `1445065030439749` ("Creative Kitchen"). Use the Willa GPT account that owns the app.

### 1. Open the app review console

1. Go to https://developers.facebook.com/apps/1445065030439749/app-review/permissions/
2. Search for **"Ads Archive API"** in the permissions and features list.
3. Click **Request advanced access**.

### 2. Complete the use case form

Meta asks the same set of questions for every Ads Archive API submission:

- **How will your app use this permission?**
  - "Creative Kitchen is an internal marketing analytics tool used by Willa Ltd's marketing team. We monitor competitor ad creative in the UK food delivery and meal-kit space (Frive, Calo, Huel, Allplants, Mindful Chef, Field Doctor, Cook, Fresh Fitness Food, Detox Kitchen, Pasta Evangelists, etc.) to inform our own creative strategy. The Ads Archive API gives us programmatic access to the same active and inactive ads that any user can view in the public Meta Ad Library."
- **Will you display ad library data to your users?**
  - "Yes. We display each ad's thumbnail, snapshot, ad copy, page name, run dates, and impression/spend ranges to our internal marketing team inside our analytics dashboard. We do not redistribute the data outside our company and we do not show it to consumers."
- **Will you store ad library data?**
  - "Yes. We store each ad in our `competitor_ads` Supabase table for trend analysis. Records are refreshed at most once per day per brand. We respect Meta's terms by not commercialising the data, not exposing it externally, and deleting brands on user request."
- **Country/region targeting?**
  - "United Kingdom (GB) for all queries. Our brands operate exclusively in the UK market."
- **Frequency / volume?**
  - "Approximately 50 fetch calls per day across 30 to 50 followed brands. Each call returns ≤25 ads. Total request volume well under 1k/day."

### 3. Provide a test path Meta can reproduce

Meta reviewers need to be able to reproduce the request. Provide:

- **Endpoint:** `GET /v23.0/ads_archive?ad_reached_countries=["GB"]&search_page_ids=[<page_id>]&ad_active_status=ALL&ad_type=ALL&fields=id,ad_creation_time,ad_creative_bodies,page_id,page_name,publisher_platforms,impressions,spend&limit=25`
- **Sample page ID:** `187701838409772` (Simmer)
- **Sample test screenshot:** Take a screenshot of the Add Competitor modal showing the "Open in Meta Ad Library →" link → the Meta Ad Library page → and the analytics dashboard rendering ads previously imported from Foreplay. Save under `docs/screenshots/meta-app-review/` before submitting.

### 4. Privacy + data handling

Meta will ask for a Data Use Checkup. Most of this is already true for Willa's privacy posture, but state explicitly:

- Data is used **only by Willa Ltd internal staff**, never sold or shared.
- Brand owners can request deletion via support@willa.gpt; we delete inside 7 days.
- Data is stored in Supabase EU region; access is limited to authenticated workspace members under RLS.

### 5. Submit and track

- Hit **Submit for review**.
- Note the submission ID in this doc and in Asana.
- Meta typically responds within 5 to 10 working days. Common rejections:
  - Missing screen recording → re-submit with a 30 to 60 second Loom of the dashboard end-to-end.
  - Description too vague → re-submit with explicit list of competitor brands tracked.

## Once Approved

1. In Supabase dashboard for `ifrxylvoufncdxyltgqt`, go to Edge Functions → `fetch-competitor-ads` → Secrets.
2. Add (or update) `META_AD_LIBRARY_ENABLED=true`.
3. Click **Save**. The next request will route through Meta automatically.
4. Smoke test by adding a brand with known zero Foreplay coverage and confirming `metaFallback.attempted: true` plus a non-zero `metaFallback.totalRows`.
5. Update this doc and `CLAUDE.md` with the activation date.

## If Meta Rejects

- Capture the rejection reason verbatim.
- File an Asana follow-up ticket with the rejection text + a re-submission plan.
- Do NOT enable `META_AD_LIBRARY_ENABLED` — keep the gate off so the user-facing link UX continues to work.

## Related Code

- `supabase/functions/fetch-competitor-ads/index.ts` — `META_AD_LIBRARY_ENABLED` gate, `metaAdLibraryUrl(pageId)` helper, `meta_app_review_pending` branch.
- `src/components/CompetitorAds.jsx` — `addLink` state, modal "Open in Meta Ad Library →" CTA.
- PR #46 (commit pending) — graceful degradation ship.
- PR #44 (commit `a1b9543`) — first failed attempt with app access token (subcode 2332004).
- PR #45 (commit `c1a3725`) — second failed attempt with system user token (subcode 2332002).
