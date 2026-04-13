# FlowSeer Production Deployment Guide
**Platform:** TG20/W251 · Client: Borderplex · Trans World Power LLC

---

## Current State

Production Next.js 14 app deployed at `ssc-v2.vercel.app`

**14 routes live:**
- `/login` — Authentication gate
- `/dashboard/overview` — Executive summary, alerts, timeline
- `/dashboard/cost-intel` — 19-category pricing, scenario modeling
- `/dashboard/supplier-network` — 73 suppliers, strategic profiles
- `/dashboard/rfq-pipeline` — 13 RFQ packages, stage flow
- `/api/health` — Platform health check
- `/api/live` — Combined data endpoint
- `/api/program/summary|rfq|pricing` — Individual data endpoints
- `/api/auth/[...nextauth]` — Auth handler

---

## Activate Authentication (5 minutes)

Add these environment variables in Vercel dashboard:

```
FLOWSEER_PASSWORD=your-chosen-password
NEXTAUTH_SECRET=run: openssl rand -base64 32
NEXTAUTH_URL=https://ssc-v2.vercel.app
```

Steps:
1. Go to vercel.com → ssc-v2 project → Settings → Environment Variables
2. Add the three variables above
3. Redeploy

Users then go to `ssc-v2.vercel.app` → redirected to `/login` → enter password → dashboard.

---

## Activate Live Neon Database (10 minutes)

1. Go to neon.tech → create free project
2. Copy the connection string (postgresql://user:pass@host/dbname)
3. Add to Vercel env vars: `DATABASE_URL=postgresql://...`
4. Run locally: `python3 tools/api/init_db.py`
5. The `/api/live` endpoint activates DB mode automatically

---

## Update Dashboard Data

When any program event occurs (RFQ response, ICD received, BH decision):

```bash
# Log the event
python3 tools/flowseer.py log

# Refresh all dashboard data files
python3 tools/flowseer.py refresh

# Push to deploy (dashboard updates in ~60 seconds)
git add -A && git commit -m "Data: [event description]" && git push origin frontend-only
```

CI/CD pipeline (.github/workflows/ci.yml) auto-runs on every push:
- 125 Python tests (45 CV + 67 pricing + 13 orchestrator)
- Next.js production build
- Dashboard data refresh

---

## Access Control Options

**Current:** Password gate via NextAuth (single shared password)
**Upgrade:** Add individual email invites via NextAuth Email Provider
**Enterprise:** Cloudflare Zero Trust — SSO with Google/Microsoft accounts

---

## Key Files

| File | Purpose |
|------|---------|
| `app/dashboard/*/page.tsx` | Four dashboard pages |
| `app/login/page.tsx` | Auth gate |
| `app/api/live/route.ts` | Combined live data endpoint |
| `components/ui/` | Design system components |
| `lib/types/flowseer.ts` | TypeScript type definitions |
| `lib/api/flowseer.ts` | Typed data fetchers |
| `styles/globals.css` | Silent State design tokens |
| `middleware.ts` | Route protection |
| `tools/flowseer.py` | Master CLI |
| `tools/dashboard/data/` | Live JSON data files |
| `.github/workflows/ci.yml` | CI/CD pipeline |

---

*FlowSeer v2.1.0 · Production Build · commit pending*
