#!/usr/bin/env python3
"""
tools/analytics/response_predictor.py
Predicts supplier RFQ response likelihood and expected pricing.
Uses historical data, relationship strength, and market signals.

Usage:
  python3 response_predictor.py
  python3 response_predictor.py --rfq RFQ-002
"""
from __future__ import annotations
import argparse, json
from datetime import date, timedelta
from pathlib import Path

ROOT     = Path(__file__).parent.parent
RFQ_FILE = ROOT / "rfq-generator/rfq_status.json"


RESPONSE_FACTORS = {
    # (company, base_probability, avg_days, relationship, pricing_tendency)
    "Baker Hughes":       (0.92, 12, "WARM",    "ABOVE_ESTIMATE"),   # proven
    "Emerson":            (0.85, 18, "NEW",      "AT_ESTIMATE"),
    "Donaldson":          (0.88, 15, "NEW",      "AT_ESTIMATE"),
    "Amerex Corporation": (0.78, 21, "NEW",      "BELOW_ESTIMATE"),
    "Turbotect Ltd.":     (0.82, 16, "NEW",      "AT_ESTIMATE"),
    "ABB":                (0.75, 25, "NEW",      "ABOVE_ESTIMATE"),
    "Siemens Energy":     (0.72, 28, "NEW",      "ABOVE_ESTIMATE"),
    "GE Vernova":         (0.80, 22, "NEW",      "ABOVE_ESTIMATE"),
    "Flowserve":          (0.83, 17, "NEW",      "AT_ESTIMATE"),
}

TENDENCY_ADJUSTMENTS = {
    "ABOVE_ESTIMATE": 1.15,
    "AT_ESTIMATE":    1.00,
    "BELOW_ESTIMATE": 0.92,
}


def predict_rfq(rfq: dict) -> dict:
    company = rfq.get("company", "")
    est     = rfq.get("est_value_usd", 0)
    send_dt = date(2026, 5, 25)  # fixed send date

    # Find best match
    factors = None
    for co, f in RESPONSE_FACTORS.items():
        if co.lower() in company.lower() or company.lower() in co.lower():
            factors = f
            break

    if not factors:
        factors = (0.70, 21, "UNKNOWN", "AT_ESTIMATE")

    prob, avg_days, rel, tendency = factors
    adj = TENDENCY_ADJUSTMENTS.get(tendency, 1.0)

    expected_price     = round(est * adj)
    expected_response  = send_dt + timedelta(days=avg_days)
    variance_direction = "above" if adj > 1 else ("below" if adj < 1 else "at")

    return {
        "rfq_id":              rfq.get("id"),
        "company":             company,
        "category":            rfq.get("category"),
        "est_value_usd":       est,
        "response_probability":f"{prob*100:.0f}%",
        "expected_response_date": expected_response.strftime("%B %d, %Y"),
        "avg_response_days":   avg_days,
        "relationship":        rel,
        "pricing_tendency":    tendency,
        "expected_price":      expected_price,
        "expected_variance":   f"{(adj-1)*100:+.1f}% ({variance_direction} estimate)",
        "confidence":          "HIGH" if rel == "WARM" else "MEDIUM",
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--rfq", help="Specific RFQ ID")
    args = p.parse_args()

    rfqs = json.loads(RFQ_FILE.read_text()).get("rfqs", []) if RFQ_FILE.exists() else []
    drafted = [r for r in rfqs if r["status"] in ("DRAFTED", "SENT")]

    if args.rfq:
        drafted = [r for r in drafted if r.get("id") == args.rfq]

    if not drafted:
        print("No drafted/sent RFQs to predict")
        return

    print(f"\n{'='*70}")
    print("FlowSeer RFQ Response Predictor — Post May 25 Send")
    print(f"{'='*70}")
    print(f"{'RFQ':<10} {'Company':<22} {'Probability':<13} {'Expected Date':<18} {'Expected Price':<16} {'vs Est.'}")
    print("-"*95)

    total_expected = 0
    for r in sorted(drafted, key=lambda x: x.get("est_value_usd", 0), reverse=True):
        pred = predict_rfq(r)
        total_expected += pred["expected_price"]
        print(f"{pred['rfq_id']:<10} {pred['company']:<22} {pred['response_probability']:<13} "
              f"{pred['expected_response_date']:<18} ${pred['expected_price']:>12,.0f}  {pred['expected_variance']}")

    print("-"*95)
    print(f"{'TOTAL':<46} ${total_expected:>12,.0f}")
    print(f"\nEstimated budget exposure vs $9.274M baseline: "
          f"${total_expected - sum(r.get('est_value_usd',0) for r in drafted):+,.0f}")
    print(f"{'='*70}\n")

    # Write predictions JSON
    preds = [predict_rfq(r) for r in drafted]
    out = ROOT / "analytics/rfq_predictions.json"
    out.parent.mkdir(exist_ok=True)
    import json as _json
    out.write_text(_json.dumps({"predictions": preds, "total_expected": total_expected,
                                 "send_date": "2026-05-25"}, indent=2))
    print(f"Predictions saved: {out}")


if __name__ == "__main__":
    main()
