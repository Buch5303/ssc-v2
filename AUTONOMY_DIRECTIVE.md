# FLOWSEER AUTONOMOUS BUILD DIRECTIVE v1.0

**Issuer:** Gregory J. Buchanan, CEO, Trans World Power
**Effective:** April 21, 2026
**Platform:** FlowSeer (repo: github.com/Buch5303/ssc-v2)
**Status:** Awaiting CEO Approval — Section IX

---

## I. PURPOSE

This directive authorizes and governs the fully autonomous operation of the FlowSeer platform. From the moment of approval, FlowSeer will design, build, test, deploy, monitor, and heal itself without human interaction, subject to the quality standard, safety rails, and boundaries defined below.

The governing quality bar is **EQS v1.0**, reproduced in full in Section II. No code, configuration change, or deployment produced autonomously may ship if it violates EQS v1.0. EQS is not aspirational. It is an enforcement gate.

---

## II. EQS v1.0 — ENTERPRISE QUALITY SPECIFICATION (THE STANDARD)

Every autonomous commit, deployment, and runtime artifact is governed by the following minimum bar. A directive that cannot meet every applicable clause is rejected by the Auditor agent and does not ship.

### A. Performance Budgets
- Dashboard load: **< 1.5 seconds** (95th percentile, cold)
- AI inference: **< 2 seconds** (95th percentile)
- Real-time data latency: **< 300 milliseconds**
- Financial-value accuracy: **±0.1%** against source of truth

### B. User Experience Standard
- **C-suite clarity in < 5 seconds:** any page must communicate its primary signal to a non-technical executive within five seconds of load.
- **Zero training required:** no tooltip, manual, or onboarding path may be assumed.
- **Tableau-level visualization:** chart quality, density, and interactivity match best-in-class BI.
- **Palantir-grade intelligence:** every number is traceable to its source; every conclusion is defensible.

### C. Data Integrity Standard
- **100% auditable data:** every displayed value resolves to its origin in one click.
- **Immutable audit logs:** append-only, tamper-evident, retained indefinitely.
- No fabricated data. No mock data in production. No placeholder text in production.

### D. Security Targets
- SOC 2 control orientation
- ISO 27001 control orientation
- Zero Trust architecture principles
- Secrets never logged; never committed to source; always encrypted at rest

### E. AI Governance (5-Agent Chain)
Every autonomous change passes through:
**Architect (Opus) → Researcher (Perplexity) + Analyst (Gemini 2.5 Pro) parallel → Builder (Sonnet) → Auditor (DeepSeek V3)**

Auditor score < 85/100 blocks the commit. Three consecutive failures route the directive to the audit queue for CEO review.

---

## III. ARCHITECTURE — THE FIVE LAYERS

### Layer 1 — Deploy Triple Redundancy

Human dependency on the GitHub → Vercel webhook is eliminated. Three independent deploy paths, each sufficient:

1. **GitHub Actions CI/CD** (`.github/workflows/deploy-vercel.yml`). Runs on every push to `main`: test → build → deploy via Vercel REST API using `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` stored as Actions secrets.
2. **In-platform deploy trigger.** `/api/auto-build` calls `POST /v13/deployments` on Vercel directly after every commit it authors. Independent of webhook.
3. **Drift Watchdog cron.** Every 6 hours: compare GitHub HEAD SHA against latest production deployment SHA. If divergent beyond one commit, force-deploy HEAD.

### Layer 2 — Perpetual Directive Generator

The fixed 5-directive queue is retired. A **Directive Generator agent** runs nightly at 02:00 ET. Inputs:
- Vercel runtime logs (last 24h, all errors and warnings)
- EQS compliance scan (any page exceeding 1.5s load, any endpoint exceeding 2s inference)
- Open items from the Settings → Roadmap table
- Unresolved alerts from Threat Radar / Incentive Radar

Output: 1–3 new directives written to `directive_queue` in Neon. The hourly `/api/auto-build` cron consumes one per hour. The system never idles because it audits itself and self-assigns the next build.

### Layer 3 — Self-Healing Deploys

Health check every 15 minutes. Triggers:
- `/api/health` returns `degraded` or `error`
- Any production deployment in `ERROR` state for > 30 minutes
- HTTP 5xx rate on any route > 1% over a 1-hour window

Response chain:
1. Pull runtime logs for the failing window → **Analyst** diagnoses root cause
2. **Builder** writes a fix under standard EQS gates
3. Auto-commit, auto-deploy
4. Third consecutive failure → **automatic rollback** to last known-good deployment via Vercel REST API
5. Alert CEO only on rollback or on a diagnosis Analyst labels as "requires human judgment"

### Layer 4 — Hard Quality Gates (CI)

No autonomous commit reaches `main` without passing all four, in order:
1. **TypeScript strict compile** — zero errors
2. **ESLint** — zero errors
3. **Test suite** — 100% pass rate, target coverage ≥ 70% on changed code
4. **Auditor agent** — ≥ 85/100 against EQS v1.0 rubric

Failure loops to Builder with the specific rubric feedback. Three retries, then directive is archived to `directive_queue.archived` with full pipeline log for CEO review.

### Layer 5 — Safety Rails

The autonomous system **may not modify** the following without a human-authored commit:

- `/api/auth/**` (identity and session)
- `/api/admin/**` (the self-management endpoint itself)
- `.github/workflows/**` (deploy path — prevents the builder from locking itself out)
- `middleware.ts` (security boundary)
- Any database migration that **drops or renames** a table or column
- Any environment variable starting with `SECRET_`, `PRIVATE_`, or containing `TOKEN` (read-only to the auto-builder)
- Any change to this directive document

Attempts to modify these paths are blocked at the Builder stage and logged.

---

## IV. OPERATIONAL BOUNDARIES

### A. Spend Cap (Hard — Tranche Model)
- **$40 USD per tranche**, aggregate across all AI agents (Anthropic + Google + Perplexity + DeepSeek)
- Tranche is cumulative, not time-bounded. There is no daily reset.
- Every API call's cost is logged to `directive_queue.spend_log` with a running total against the active tranche.
- When the running total reaches **$40.00**, the system **halts immediately**:
  - All in-flight directives pause cleanly at the next safe checkpoint
  - The hourly auto-build cron stops picking up new directives
  - The Directive Generator stops producing new work
  - An authorization request is sent to the CEO via email + `/dashboard/notifications`
- The system **does not** resume until the CEO explicitly approves the next $40 tranche. Approval methods:
  1. Reply "approve tranche" to the notification email
  2. A CEO-authored commit setting `.flowseer/tranche_approved=true`
  3. POST to `/api/admin` with `action=approve_tranche` (CEO-authenticated)
- Upon approval, a new tranche begins at $0.00 and the system resumes.
- Scope: this cap covers AI agent API spend only. Infrastructure costs (Vercel, Neon, domain) are billed separately and outside this mechanism.
- Reference: at current rates, one full 5-agent pipeline costs ~$0.30–$1.20. A $40 tranche covers approximately 33–130 complete build cycles.

### B. Commit Authorship
- All autonomous commits authored by `FlowSeer Bot <bot@flowseer.ai>`
- Never under the CEO's name
- Every commit message format:
  `[AUTO-{id}] {summary} — Auditor: {score}/100, EQS: {pass|fail-with-exceptions}`

### C. Audit Trail
- Every directive: full pipeline log written to immutable Neon `audit_trail` table
- Every commit: linked to its originating directive ID
- Every deployment: linked to its commit SHA
- Every rollback: logged with triggering condition, affected commit, and recovery commit
- Retained indefinitely; surfaced in `/dashboard/audit-trail`

### D. Rate Limits
- Max 24 autonomous commits per 24 hours
- Max 1 in-flight directive at a time (no parallel builds)
- Max 3 deploy attempts per directive

---

## V. HUMAN-IN-THE-LOOP TRIGGERS

The system **must** pause and notify the CEO when any of the following occur:

1. **$40 tranche depleted** — system halts and requests CEO authorization for next tranche
2. Three consecutive Auditor rejections on the same directive
3. An automatic rollback is executed
4. A Layer 5 safety-rail violation is attempted (logged + blocked + reported)
5. A directive proposes schema changes categorized as destructive
6. Runtime error rate exceeds 5% on any production route for > 1 hour
7. Daily drift watchdog finds production more than 5 commits behind `main`
8. Analyst agent classifies a diagnosis as "requires human judgment"

Notification method: email to `gbuchanan@bballc.net` + in-platform notification at `/dashboard/notifications`.

---

## VI. EQS ENFORCEMENT MECHANICS

EQS v1.0 (Section II) is not embedded only in agent prompts. It is enforced as follows:

| EQS Clause | Enforcement Mechanism |
|---|---|
| Dashboard load < 1.5s | Lighthouse CI gate on every deploy |
| AI inference < 2s | Pipeline timing assertion in test suite |
| Real-time latency < 300ms | Synthetic monitor every 5 minutes |
| Financial accuracy ±0.1% | Reconciliation test against source JSON / Neon |
| C-suite clarity < 5s | Auditor rubric item (visual hierarchy, primary signal) |
| Zero training UX | Auditor rubric item (no tooltip dependency) |
| 100% auditable data | Schema constraint: every display value has a `source_ref` |
| Immutable audit logs | Neon table with `REVOKE UPDATE, DELETE` on role |
| No fabricated data | Builder system prompt + Auditor rubric + reviewer check |
| 5-agent AI governance | CI job refuses to merge if pipeline log absent |

An EQS clause cannot be waived by the Builder or Auditor. A waiver requires a CEO-authored commit to this directive.

---

## VII. WHAT THE SYSTEM WILL PRODUCE (FIRST 30 DAYS)

Under this directive, the Directive Generator will prioritize the following roadmap items already defined in the Session Turnover:

**Week 1 — Data Foundation**
Neon DB full migration; live data pipeline; cutover from JSON fallback.

**Week 2 — Core Workflows**
RBAC (Admin / PM / Viewer); Mailgun integration; end-to-end RFQ response lifecycle.

**Week 3 — Quality & Compliance**
Audit trail page wired to Neon; dashboard performance pass to hit 1.5s budget; error/edge-case hardening.

**Week 4 — User Experience**
Notification system (email + in-app); mobile responsive pass.

**Week 5 — Testing & Security**
Test suite expansion to 250+; API documentation; security audit pass.

**Week 6 — Hardening**
Operational documentation; final QA; Base Module declared production-ready.

Any deviation from this sequence must be surfaced to the CEO before execution.

---

## VIII. REVOCATION

CEO may revoke this directive at any time by any of:
1. Posting a commit to `main` that modifies `.flowseer/autonomy.lock` to `disabled`
2. Setting Vercel env var `AUTONOMY_DISABLED=true`
3. Disconnecting the GitHub App for `Buch5303/ssc-v2`
4. A single Slack / email / SMS instruction to halt

On revocation, all in-flight directives complete or abort cleanly, the hourly cron pauses, and the system returns to human-directed-only operation.

---

## IX. APPROVAL

By approving this directive, the CEO authorizes FlowSeer to operate under Sections I–VIII until revoked.

**Approved by:** _________________________
**Name:** Gregory J. Buchanan
**Title:** Chief Executive Officer, Trans World Power
**Date:** _________________________

---

## X. ATTESTATION (FLOWSEER BOT)

Upon CEO approval, FlowSeer Bot is required to commit the following attestation to the repository as `/AUTONOMY_ATTESTATION.md` before any autonomous commit is issued:

> I, FlowSeer Bot, operating under Autonomous Build Directive v1.0, affirm that every commit I author is governed by EQS v1.0, has passed the full 5-agent pipeline, and does not modify any Layer 5 protected path. All safety rails, spend caps, and escalation triggers defined in the directive are active and enforced. Violations are grounds for immediate revocation.

---

**END OF DIRECTIVE**
