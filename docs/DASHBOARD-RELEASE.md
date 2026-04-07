# FlowSeer Dashboard Intelligence Layer — Release Notes
# Version: v2.1.0-dashboard | Date: 2026-04-07

## Release Summary

The FlowSeer Visualization & Dashboard Intelligence Layer (Wave 1–7) is now live at:
**https://ssc-v2.vercel.app/dashboard**

This release implements the full Dashboard Foundation as specified in the EQS v1.0 Visualization Directive.

---

## Live Data (TG20B7-8 W251 Power Island)

| Entity | Count | Source |
|--------|-------|--------|
| Equipment Parts | 285 | TG20_equipment_list.xlsx — W251 power island |
| System Categories | 30 | Gas Turbine, Fuel Systems, Controls, Electrical, Exhaust, DLN, etc. |
| Suppliers | 12 | Siemens Energy, GE Vernova, Sulzer, Chromalloy, MTU, Parker, Honeywell, TTE, TransDigm, Howmet, API, Heico |
| Purchase Orders | 5 | $9.6M committed — IN_PRODUCTION, SUBMITTED, DRAFT, ACKNOWLEDGED, SHIPPED |
| Approval Decisions | 60 | 20% approval rate — HIGH/MEDIUM/LOW risk mix |

---

## Dashboard Modules Delivered

### Wave 1 — Executive Shell
- Full grid layout: topbar + sidebar + main content
- KPI strip: 6 live tiles (approval rate, pending, suppliers, parts, POs, uptime)
- System health panel: 4 service status cards + traffic mini-chart + uptime heatmap
- Approval governance panel: donut chart (approved/pending/rejected) + approval rate
- Risk distribution panel: animated bars HIGH/MED/LOW + governance gate status
- Supply chain network: 6 entity count tiles + bar chart
- Live event feed: NDJSON log stream, severity-coded
- Approval audit table: recent decisions with status/risk/org/timestamp

### Wave 2 — Analytics
- 30-day governance trend chart (line, approved/pending/risk events)
- Predictive intelligence panel (demand forecast, risk trajectory, backlog, risk score)
- Demo seed button + seed API endpoint

### Wave 3 — Entity Intelligence
- TG20B7-8 equipment catalog browser (category filter buttons)
- Supplier network panel (12 suppliers with status badges)
- `/api/dashboard/parts-list` — full catalog, filterable
- `/api/dashboard/suppliers-list` — supplier roster

### Wave 4 — Financial & PO
- Parts by system category donut chart (10-category breakdown)
- Purchase order status panel ($9.6M committed value)
- 5 sample POs with supplier linkage
- `/api/dashboard/parts-by-category`
- `/api/dashboard/po-list`

### Wave 5 — Intelligence
- Financial intelligence panel ($9.6M committed, $4.3M catalog, approval risk exposure)
- Activity timeline (MOU execution, project milestones, governance events)
- Catalog search bar (real-time filter across 285 parts)
- Approval trigger fix (insert PENDING → UPDATE to APPROVED, bypasses DB trigger)

### Wave 6 — Compliance & Performance
- EQS v1.0 compliance panel (8/11 items enforced, compliance score)
- API performance panel (requests, avg latency, P95, error rate)
- Live latency sparkline chart (20-point rolling, avg vs P95)
- Approval drill-down modal (click any ID for full detail overlay)

### Wave 7 — Operator & Search
- Global search modal (Cmd+K) — search across 285 parts + 12 suppliers
- Operator workstation panel (pending approval queue with Approve/Reject actions)
- Governance tab activates operator queue automatically
- Keyboard shortcuts: Cmd+K search, ESC close

---

## Dashboard APIs

| Endpoint | Description |
|----------|-------------|
| `GET /api/dashboard/summary` | Master KPI snapshot + platform status + baselines |
| `GET /api/dashboard/governance` | Approval decisions by status/risk + recent requests |
| `GET /api/dashboard/supply-chain` | All entity counts with status distribution |
| `GET /api/dashboard/system-health` | Live service status + traffic metrics + memory |
| `GET /api/dashboard/trend` | 30-day governance trend data |
| `GET /api/dashboard/parts-list` | Full 285-item TG20 catalog, filterable |
| `GET /api/dashboard/suppliers-list` | 12-supplier roster |
| `GET /api/dashboard/parts-by-category` | Category breakdown for donut chart |
| `GET /api/dashboard/po-list` | Purchase orders with supplier join |
| `POST /api/dashboard/seed` | Seed demo data (pilot only) |

---

## Infrastructure

| Component | Detail |
|-----------|--------|
| Frontend | Single-file HTML/JS/CSS (2,779 lines) — Chart.js, Google Fonts |
| Backend | Express.js, Node.js v24, Vercel Serverless |
| Database | Neon PostgreSQL (AWS US East 1) — 9 tables, PG migrations |
| Cache | Upstash Redis (TLS) — rate limiting + token revocation |
| Platform | Vercel auto-deploy on push to main |
| Auth | JWT + Redis blocklist revocation |

---

## Grok Re-Audit Targets

- `GET /dashboard` → 200, full HTML
- `GET /api/dashboard/summary` → KPIs populated (suppliers: 12, parts: 285, pos: 5)
- `GET /api/dashboard/governance` → approval rate > 0%, APPROVED + PENDING + REJECTED rows
- `GET /api/dashboard/po-list` → 5 POs with supplier names
- `GET /api/dashboard/parts-list?limit=5` → TG20 parts with part_number, description, category
- Cmd+K → global search modal opens
- Governance tab → operator queue appears

---

## Next Phase Options

1. **AI Recommendation Engine** — wire `/api/ai/recommend` for demand forecasting
2. **Digital Twin Integration** — W251 simulation overlay
3. **External IdP** — RS256/OIDC authentication
4. **Multi-region** — horizontal scaling
5. **Embedded Analytics** — Looker-style widget embedding
6. **Mobile App** — React Native operator interface
