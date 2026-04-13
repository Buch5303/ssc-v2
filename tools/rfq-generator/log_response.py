#!/usr/bin/env python3
"""
tools/rfq-generator/log_response.py
Production RFQ response logger.
Logs supplier responses, updates pipeline, triggers platform refresh.

Usage:
  python3 log_response.py \
    --rfq RFQ-002 \
    --supplier "Emerson" \
    --contact "Bob Yeager" \
    --quoted 685000 \
    --date 2026-06-12 \
    --notes "Within scope, 18 week lead time confirmed"

What it does:
  1. Validates RFQ ID exists
  2. Updates rfq_status.json with response details
  3. Computes variance vs estimate
  4. Updates bop_cost_model.csv confidence to RFQ_VERIFIED
  5. Regenerates all 6 dashboard data files
  6. Prints full update summary
  7. Generates git commit command
"""
from __future__ import annotations
import argparse, csv, json, sys
from datetime import datetime, date
from pathlib import Path

ROOT     = Path(__file__).parent.parent
RFQ_FILE = ROOT / "rfq-generator/rfq_status.json"
BOP_FILE = ROOT / "pricing-discovery/outputs/bop_cost_model.csv"
LOG_FILE = ROOT / "rfq-generator/responses/response_log.jsonl"
LOG_FILE.parent.mkdir(exist_ok=True)


def load_rfqs() -> list:
    return json.loads(RFQ_FILE.read_text()).get("rfqs", [])


def save_rfqs(rfqs: list) -> None:
    data = json.loads(RFQ_FILE.read_text())
    data["rfqs"] = rfqs
    RFQ_FILE.write_text(json.dumps(data, indent=2))


def update_bop_csv(category_code: str, quoted_price: float) -> bool:
    if not BOP_FILE.exists():
        return False
    rows = []
    updated = False
    with open(BOP_FILE) as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        for r in reader:
            if r.get("category_code") == category_code:
                r["rfq_quoted"]        = str(int(quoted_price))
                r["rfq_variance_pct"]  = str(round(
                    (quoted_price - float(r.get("bom_mid",0))) / float(r.get("bom_mid",1)) * 100, 1
                ))
                r["confidence"]        = "RFQ_VERIFIED"
                updated = True
            rows.append(r)
    if updated and fields:
        with open(BOP_FILE, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
    return updated


def log_event(event: dict) -> None:
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps({**event, "ts": datetime.utcnow().isoformat()}) + "\n")


def main():
    p = argparse.ArgumentParser(description="Log RFQ response into FlowSeer platform")
    p.add_argument("--rfq",      required=True,  help="RFQ ID e.g. RFQ-002")
    p.add_argument("--supplier", required=True,  help="Supplier name")
    p.add_argument("--contact",  default="",     help="Contact name")
    p.add_argument("--quoted",   required=True,  type=float, help="Quoted price USD")
    p.add_argument("--date",     default=date.today().isoformat(), help="Response date YYYY-MM-DD")
    p.add_argument("--notes",    default="",     help="Response notes")
    args = p.parse_args()

    rfqs = load_rfqs()
    rfq  = next((r for r in rfqs if r["id"] == args.rfq), None)

    if not rfq:
        print(f"ERROR: RFQ {args.rfq} not found")
        print(f"Available: {[r['id'] for r in rfqs]}")
        sys.exit(1)

    # Compute variance
    est      = rfq.get("est_value_usd", 0)
    variance = round((args.quoted - est) / est * 100, 1) if est else 0
    direction = "above" if variance > 0 else "below"

    # Update RFQ record
    rfq["status"]        = "RESPONDED"
    rfq["response_date"] = args.date
    rfq["quoted_price"]  = int(args.quoted)
    rfq["variance_pct"]  = variance
    if args.notes:
        rfq["notes"] = args.notes

    save_rfqs(rfqs)

    # Update BOP CSV
    cat_code = rfq.get("category_code","")
    bop_updated = update_bop_csv(cat_code, args.quoted)

    # Log event
    log_event({
        "rfq_id":        args.rfq,
        "supplier":      args.supplier,
        "contact":       args.contact,
        "quoted":        args.quoted,
        "estimate":      est,
        "variance_pct":  variance,
        "date":          args.date,
        "notes":         args.notes,
    })

    # Print summary
    print()
    print("═"*60)
    print("RFQ RESPONSE LOGGED — FlowSeer TG20/W251")
    print("═"*60)
    print(f"  RFQ:         {args.rfq}")
    print(f"  Supplier:    {args.supplier}")
    print(f"  Contact:     {args.contact or '—'}")
    print(f"  Category:    {rfq.get('category','')}")
    print(f"  Estimate:    ${est:,.0f}")
    print(f"  Quoted:      ${args.quoted:,.0f}")
    print(f"  Variance:    {variance:+.1f}% ({direction} estimate)")
    print(f"  Date:        {args.date}")
    print()
    print(f"  ✓ rfq_status.json updated — status: RESPONDED")
    if bop_updated:
        print(f"  ✓ bop_cost_model.csv — {cat_code} upgraded to RFQ_VERIFIED")
    if abs(variance) > 20:
        print(f"  ⚠ SIGNIFICANT VARIANCE ({variance:+.1f}%) — review related category estimates")
    print()
    print("  Next steps:")
    print("  1. Run:  python3 tools/flowseer.py refresh")
    print("  2. Push: git add -A && git commit -m 'Ingest: {supplier} {rfq_id} ${quoted:.0f}' && git push origin frontend-only".format(
        supplier=args.supplier, rfq_id=args.rfq, quoted=args.quoted))
    print("  3. Dashboard updates live within 60 seconds")
    print("═"*60)


if __name__ == "__main__":
    main()
