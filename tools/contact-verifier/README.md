# FlowSeer Contact Verifier
## Directive 52 — Free-First Contact Verification Automation

Verifies supplier contact emails using a 10-layer free-first source stack before touching paid APIs.

---

## Source Stack (in order)

| Layer | Source | Free Tier | Key Required |
|-------|--------|-----------|--------------|
| 1 | Google Programmable Search | 100/day | Yes |
| 2 | SEC EDGAR full-text | Unlimited | No |
| 3 | Wikidata entity search | Unlimited | No |
| 4 | GitHub user search | 5,000/hr with token | Optional |
| 5 | NewsAPI | 100/day | Yes |
| 6 | ORCID publications | Unlimited | No |
| 7 | OpenCorporates officers | 500/day with key | Optional |
| 8 | Domain MX validation | Unlimited | No |
| 9 | Hunter email finder/verifier | 50/mo | Optional |
| 10 | Apollo (priority fallback) | Limited credits | Optional |

---

## Quick Start

```bash
cd tools/contact-verifier
pip install requests python-dotenv
cp .env.example .env
# Fill in at minimum: GOOGLE_API_KEY, GOOGLE_CSE_ID, GITHUB_TOKEN

# Run on sample contacts
cp contacts_sample.csv contacts.csv
python contact_verifier.py --limit 20

# Run priority contacts only
python contact_verifier.py --priority ACTIVE_RFQ TIER1

# Dry run (no API calls)
python contact_verifier.py --dry-run
```

---

## Output Files

| File | Contents |
|------|----------|
| `contacts_verified.csv` | All contacts with verification results appended |
| `verification_log.jsonl` | Full audit trail — every API call and result |
| `verification_summary.txt` | Count breakdown by status |

---

## Status Vocabulary

| Status | Meaning | Ready for RFQ |
|--------|---------|---------------|
| `VERIFIED_EMAIL` | Confirmed by Hunter or Apollo | YES |
| `LIKELY_CORRECT` | Public evidence + domain pattern | REVIEW FIRST |
| `DOMAIN_PATTERN_ONLY` | Domain known, email inferred | REVIEW FIRST |
| `NEEDS_REVIEW` | All layers exhausted | NO |

---

## Priority Levels

| Priority | Who | Apollo Fallback |
|----------|-----|----------------|
| `ACTIVE_RFQ` | Active RFQ recipients (Baker Hughes CEO) | YES |
| `TIER1` | Tier 1 / strategic OEM executives | YES |
| `BLOCKED` | Contacts needed for blocked categories | YES |
| `HIGH_VALUE` | Categories > $300K mid estimate | NO |
| `NORMAL` | All others | NO |

---

## Free-First Operating Cadence

1. Run top 20 priority contacts first (`--limit 20 --priority ACTIVE_RFQ TIER1`)
2. Review `contacts_verified.csv` — promote VERIFIED and LIKELY records
3. Run remaining HIGH_VALUE contacts
4. Manual review of NEEDS_REVIEW records
5. Update RFQ status in main contact database
6. Repeat weekly during active sourcing period

---

## Getting Your Free API Keys

- **Google CSE**: https://programmablesearchengine.google.com → create engine → get API key at https://console.cloud.google.com
- **GitHub Token**: https://github.com/settings/tokens → new token → no scopes needed
- **NewsAPI**: https://newsapi.org/register
- **Hunter**: https://hunter.io/api-keys
- **Apollo**: https://app.apollo.io/#/settings/integrations/api

SEC EDGAR, Wikidata, ORCID, and OpenCorporates base tier require no registration.
