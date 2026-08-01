# M365 Guardian

A self-serve Microsoft 365 / Entra ID security posture scanner. Connect a
tenant, get a scored report on the same recurring misconfigurations that
show up in nearly every manual M365 security audit.

## What it checks (v1)

- Security Defaults / baseline MFA enforcement
- A Conditional Access policy requiring MFA for all users, all apps
- Whether any MFA-enforcing CA policy has a break-glass exclusion
- Guest invitation policy (who can invite external users)
- Number of Global Administrators
- Percentage of users registered for MFA
- Global Administrators with **no** MFA method registered (the single
  highest-impact finding this tool can surface)
- Admin consent workflow status for third-party app permissions

Everything here uses **read-only** Microsoft Graph permissions. Nothing is
ever modified in a customer's tenant.

## Architecture

- `public/index.html` - connect flow + report dashboard (static, no build step)
- `api/config.js` - exposes the public (non-secret) Azure app client ID to the browser
- `api/consent-callback.js` - receives the redirect after a tenant admin grants consent
- `api/scan.js` - gets an app-only Graph token for the target tenant and runs the checks
- `lib/graph.js` - Graph API token + paginated GET helper
- `lib/checks.js` - the actual check logic and scoring

Tenant connections and scan results are cached in Upstash Redis (same setup
as before: Vercel Storage → Create Database → Upstash → Redis).

## One-time setup you have to do yourself: Azure App Registration

I can't create this for you - it requires your own Microsoft Entra admin
access. This is a one-time setup, not something you repeat per customer.

1. Go to **entra.microsoft.com** (or portal.azure.com → Microsoft Entra ID) → **App registrations** → **New registration**.
2. Name it anything (e.g. "M365 Guardian").
3. Under **Supported account types**, choose **"Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)"** - this is required so *other people's* tenants can connect, not just yours.
4. Leave Redirect URI blank for now, click **Register**.
5. Once created, go to **Authentication** → **Add a platform** → **Web** → set the redirect URI to:
   `https://<your-vercel-domain>/api/consent-callback`
   (you'll need to come back and update this once you know your real Vercel URL).
6. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions** (not Delegated), and add:
   - `Policy.Read.All`
   - `Directory.Read.All`
   - `RoleManagement.Read.Directory`
   - `Reports.Read.All`
   - `AuditLog.Read.All`
   Then click **Grant admin consent** for your own tenant (this only affects your dev tenant, not customers - each customer grants their own consent through the app's normal flow).
7. Go to **Certificates & secrets** → **New client secret** → copy the **value** immediately (it's only shown once).
8. Note down: the **Application (client) ID** from the Overview page, and the **client secret value** from step 7.

### Testing without a real customer tenant

Sign up for a free **Microsoft 365 Developer Program** tenant
(developer.microsoft.com/microsoft-365/dev-program) - it gives you a
sandbox tenant with Global Admin access and test users, so you can safely
test the full connect-and-scan flow before pointing this at anyone real.

## Deploying (same pattern as before)

1. Push this folder to a new GitHub repo.
2. Import it on **vercel.com/new**.
3. In the project's **Environment Variables**, add:
   - `AZURE_CLIENT_ID` = the Application (client) ID from step 8 above
   - `AZURE_CLIENT_SECRET` = the client secret value from step 8 above
4. Attach an Upstash Redis database the same way as the last project (**Storage → Create Database → Upstash → Redis → Connect to Project**).
5. Redeploy so all env vars take effect.
6. Go back into your Azure App Registration's **Authentication** blade and update the redirect URI to your actual `https://your-project.vercel.app/api/consent-callback`.

## Trying it

Open your deployed URL, click **Connect your Microsoft 365 tenant**, sign in
with an account that has Global Administrator rights on the tenant you want
to scan (your dev tenant to start), review the permissions Microsoft shows
you, approve, and you'll land back on a scored report.

## Security fixes from the post-build audit (already implemented)

- **Report access control**: viewing/re-scanning a tenant now requires a private, randomly-generated access token issued at connect time - the tenant ID alone in a URL is no longer enough to see someone's report.
- **CSRF protection**: the consent flow now issues and verifies a one-time state token via an httpOnly cookie, so the redirect callback can't be spoofed or replayed.
- **Data retention**: connection records and scan results now expire automatically after 90 days (configurable via `RETENTION_SECONDS` in `api/scan.js` and `api/consent-callback.js`).
- **Disconnect & delete**: `api/disconnect.js` lets a tenant admin wipe their stored data on demand, surfaced as a button on the report page.
- **Large-tenant timeout safety**: the MFA registration check now caps at 5 pages (~5,000 users) to stay within Vercel's serverless execution limits.
- **Tenant display name**: reports now show the real organization name instead of a raw GUID.
- Added placeholder **privacy policy** and **terms of service** pages (`public/privacy.html`, `public/terms.html`) - these are scaffolding only, not final legal text. Get an actual lawyer to review before connecting real customer tenants, especially for GDPR/UK GDPR exposure if you'll have EU/UK customers.
- Added favicon and Open Graph/meta tags so links shared in MSP communities preview properly instead of showing a bare link.
- Merged the marketing content directly into the landing page so it's wired to the real connect flow, rather than living on a separate static page with dead links.

## Go-live checklist (everything left that only you can do)

I can write and verify all the code, but the following steps need your own
accounts/credentials - I can't create these for you. Do them in this order:

1. **Azure App Registration** (one-time, ~10 min) - see the section below.
   Gives you `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`.
2. **Deploy to Vercel** - push this repo, import on vercel.com/new, attach
   Upstash Redis (Storage → Create Database → Upstash → Redis).
3. **Stripe account** (for monetization):
   - Sign up at stripe.com if you don't have an account.
   - Create one Product ("M365 Guardian Pro") with a recurring $49/mo Price.
     If you connect the Stripe MCP in this chat, tell me and I'll create the
     product/price for you directly instead of you clicking through the
     dashboard.
   - Copy the **Price ID** (`price_...`) → set as `STRIPE_PRICE_ID`.
   - Copy your **Secret key** → set as `STRIPE_SECRET_KEY`.
   - In Stripe Dashboard → Developers → Webhooks, add an endpoint pointing
     to `https://<your-domain>/api/stripe-webhook`, listening for
     `checkout.session.completed`, `customer.subscription.deleted`, and
     `customer.subscription.paused`. Copy the **Signing secret** → set as
     `STRIPE_WEBHOOK_SECRET`.
4. **Set all env vars in Vercel** (Project → Settings → Environment
   Variables), then redeploy: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
   `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`,
   `CRON_SECRET` (any random string), and optionally
   `AZURE_CLIENT_SECRET_EXPIRES`.
5. **Update the Azure redirect URI** to your real Vercel domain (see below),
   and replace `YOUR-DOMAIN-HERE` in `public/robots.txt` and
   `public/sitemap.xml` with the same domain.
6. **Test the full loop** on your free Microsoft 365 Developer tenant:
   connect, scan, link to dashboard, upgrade with a Stripe test card
   (`4242 4242 4242 4242`), confirm the dashboard flips to Pro, then test
   "Manage billing" cancels correctly.
7. **Get privacy.html / terms.html reviewed by an actual lawyer** before
   connecting any real customer's tenant. Flagged in the code as
   placeholders, not final legal text.
8. **Start outreach.** Templates ready in `marketing/outreach-templates.md`.
   Fastest path per the earlier research: ask 2-3 people you already know
   (MSP owners, IT admins) to run it as a design partner before any public
   posting.

## Recently added

- **Rate limiting** on `/api/scan.js` - 1 scan per tenant per 60s, and a per-IP hourly cap (fails open if Redis is briefly unavailable, so an outage doesn't hard-block scans).
- **Scan history + trend** - each scan is compared to the previous one (`previousScore` / `scoreDelta` on the report), and the last 10 scores per tenant are kept (`api/history.js`) to render a small trend bar chart on the report page.
- **Client secret expiry warning** - set `AZURE_CLIENT_SECRET_EXPIRES` (ISO date, matches the expiry shown in Azure) and the app will log a console warning once you're within 30 days of it lapsing. Operator-facing only, not shown to visitors.
- **Basic MSP multi-tenant dashboard** - from any report page, "Add to MSP dashboard" links that tenant into a dashboard keyed by a generated `mspKey` (treat it like a password - anyone holding it can see every linked tenant's score and open its full report). Visit `/?msp=<key>` to view it. Backed by `api/msp-link.js`, `api/msp-dashboard.js`, `api/msp-unlink.js`.
- **Monetization (Stripe)** - free plan tracks 1 tenant per dashboard; Pro ($49/mo) unlocks unlimited tenants via Stripe Checkout. `api/create-checkout-session.js` starts checkout, `api/stripe-webhook.js` unlocks/revokes access on subscription events. Requires the `stripe` npm package (added to `package.json` - run `npm install` before deploying) plus the Stripe env vars in the checklist above.
- **PDF export** - "Download PDF" on the report page uses the browser's native print-to-PDF (a dedicated print stylesheet hides nav/buttons), so no extra JS dependency.
- **Go-to-market assets** - `marketing/outreach-templates.md` has ready-to-send cold email, LinkedIn DM, Reddit, Show HN, and design-partner outreach templates based on the market research (MSPs are the real buyer, manual audits cost $1,200-$9,000).
- **Stripe billing portal** - Pro customers get a "Manage billing" link (`api/create-portal-session.js`) to self-serve cancel/update payment instead of emailing you.
- **Weekly auto re-scan for Pro tenants** - `api/cron-rescan.js` + `vercel.json` re-scans every tenant on a Pro dashboard every Monday, so the dashboard is never more than a week stale. Protect it with a `CRON_SECRET` env var.
- **Tests** - `test/checks.test.js` and `test/debug.test.js` (pagination/graph helper tests) use Node's built-in test runner, no extra dependency. Run with `node --test test/checks.test.js test/debug.test.js`. Catches real logic bugs (one test run here caught an actual mock-signature bug before it could hide a scoring bug).
- **UI rewrite** - the landing/report/dashboard pages were rebuilt away from the original dark-gradient "AI SaaS" template look toward a plain, utilitarian style (system fonts, light background, minimal color, no glossy cards) that reads more like a real security tool than a generated landing page. All copy also had em dashes removed.
- **SEO basics** - `public/robots.txt` and `public/sitemap.xml` (replace `YOUR-DOMAIN-HERE` with your real domain after deploying).

## Known gaps still open (roadmap, not yet built)

- **MSP dashboard has no real auth** - the `mspKey` is a bearer secret in a URL, not a login. Fine for an MVP/design-partner test, but before wider MSP rollout this should move to real accounts (magic link or OAuth), since URLs leak easily (browser history, screen shares, Slack pastes).
- **No automated secret rotation** - the expiry warning only logs to console; it doesn't email/notify you, and rotating still has to be done manually in Azure.
- **No proration/downgrade UX** - canceling in Stripe's customer portal removes Pro access via webhook, but there's no in-app "manage billing" link yet (would need a Stripe Billing Portal session, easy follow-up).
- **No automated re-scan/monitoring** - re-scans are still manual (click "Re-scan now" or via the dashboard). A Vercel Cron job that re-scans every Pro tenant weekly and emails a digest would be a strong retention feature, not yet built.

