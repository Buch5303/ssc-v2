#!/usr/bin/env python3
"""
tools/contracts/contract_template_generator.py
Generates purchase order and contract templates for BOP awards.

Usage:
  python3 contract_template_generator.py --category VIB_MON --supplier "Baker Hughes" --value 340000
  python3 contract_template_generator.py --list
"""
from __future__ import annotations
import argparse, csv
from datetime import datetime, date
from pathlib import Path

ROOT = Path(__file__).parent.parent

PO_TEMPLATE = """PURCHASE ORDER
Trans World Power LLC
Project Jupiter — W251B8 BOP Package

PO Number:    TWP-{year}-{seq:04d}
Date:         {date}
Revision:     0

VENDOR:
{supplier}
[Address]
[City, State, ZIP]
[Phone] | [Email]

SHIP TO:
Santa Teresa Power Station
[Site Address]
Santa Teresa, NM 88008

PROJECT: Project Jupiter — 50MW W251B8 Power Island
PROGRAM MANAGER: Trans World Power LLC
GT SUPPLIER: EthosEnergy Italia

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LINE ITEMS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Item 01: {category}
  Description: {description}
  Quantity:    1 Lot
  Unit Price:  ${value:,.2f}
  Total:       ${value:,.2f}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PO TOTAL:    ${value:,.2f} USD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TERMS AND CONDITIONS:

1. DELIVERY
   Required delivery: Per agreed schedule. Vendor to confirm within 5 business days.
   Delivery point: Santa Teresa, NM project site (DDP Incoterms 2020)
   Expedite notification: Vendor to notify TWP immediately if delivery is at risk.

2. PAYMENT TERMS
   30% upon PO execution (net 15)
   40% upon factory acceptance test (FAT) completion
   30% upon site delivery and inspection acceptance

3. QUALITY REQUIREMENTS
   Vendor shall provide: ITP (Inspection Test Plan), FAT procedure, and QA documentation.
   TWP reserves the right to witness FAT at vendor facility.
   All equipment shall comply with applicable codes: ASME, NFPA, IEEE, NEC as applicable.

4. WARRANTY
   Vendor warrants all equipment for 24 months from First Power or 30 months from delivery,
   whichever occurs first.

5. DOCUMENTATION
   Vendor shall provide within 30 days of PO: general arrangement drawings, data sheets,
   preliminary O&M manual, spare parts list with pricing.

6. LIQUIDATED DAMAGES
   Delivery delay: $5,000 per calendar day after scheduled delivery date.
   Maximum LD exposure: 10% of PO value.

7. INTELLECTUAL PROPERTY
   Vendor retains IP in equipment. TWP receives license to use all documentation and
   software for operation and maintenance of the project.

8. GOVERNING LAW
   This PO is governed by the laws of the State of New Mexico, USA.

ACCEPTANCE:

Trans World Power LLC                    {supplier}
_______________________                  _______________________
Greg Buchanan, CEO                       [Authorized Signatory]
Date: _______________                    Date: _______________

[TWP Address]                            [Vendor Address]
"""

CATEGORY_DESCRIPTIONS = {
    "VIB_MON":      "Bently Nevada 3500 Series Vibration Monitoring System for W251B8 gas turbine, complete with proximitors, monitors, rack, and integration to plant DCS",
    "INLET_AIR":    "Inlet Air Filtration System for W251B8, including primary and secondary filter stages, moisture separator, anti-icing, silencer, and associated ductwork",
    "FUEL_GAS":     "Fuel Gas Conditioning Skid for W251B8, including pressure regulation (Fisher), flow metering (Daniel), filtration, heating, and all instrumentation",
    "TRANSFORMER":  "Step-Up Transformer (GSU) for W251B8, [MVA rating per EthosEnergy ICD], [13.8kV/[HV] voltage], ONAN/ONAF cooling, complete with protection relays and accessories",
    "GENERATOR":    "Synchronous Generator and Main Electrical Switchgear for W251B8, [MVA rating], complete with excitation system, protection, and 13.8kV generator circuit breaker",
    "EMISSIONS":    "Selective Catalytic Reduction (SCR) and CO Catalyst System for W251B8, designed to meet [NM permit limits], complete with ammonia injection grid and controls",
    "EXHAUST":      "Exhaust System for W251B8 including diffuser, expansion joints, transition duct, silencer, and exhaust stack, complete to grade",
    "CONTROLS_DCS": "BOP Control System and DCS Integration for W251B8 power island, including PLC, HMI, SCADA interface, field instrumentation, and commissioning",
    "FIRE_FIGHT":   "Fire Detection and Suppression System for W251B8 turbine enclosure and transformer area, per NFPA 750 and applicable codes",
    "WATER_WASH":   "Online and Offline Compressor Washing System for W251B8, including wash fluid storage, pump, nozzle manifold, and controls",
    "ELEC_DIST":    "Auxiliary Electrical Distribution System for W251B8 BOP, including MV/LV switchgear, MCCs, UPS, and cable distribution",
    "ACOUSTIC":     "Acoustic Enclosure and Noise Control Package for W251B8, designed to meet [site noise limits] at property boundary",
    "PIPING_VALVES":"BOP Interconnect Piping and Valves for W251B8, including lube oil piping, fuel gas piping, cooling water piping, and all associated valves and fittings",
}


def generate_po(category_code, supplier, value, seq=1):
    desc = CATEGORY_DESCRIPTIONS.get(category_code, f"[{category_code} — description to be confirmed]")

    # Find category name
    p = ROOT / "pricing-discovery/outputs/pricing_updated.csv"
    cat_name = category_code
    if p.exists():
        with open(p) as f:
            for r in csv.DictReader(f):
                if r.get("category_code") == category_code:
                    cat_name = r.get("category", category_code)
                    break

    return PO_TEMPLATE.format(
        year=date.today().year,
        seq=seq,
        date=date.today().strftime("%B %d, %Y"),
        supplier=supplier,
        category=cat_name,
        description=desc,
        value=value,
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--category",  help="Category code (e.g. VIB_MON)")
    p.add_argument("--supplier",  help="Supplier name")
    p.add_argument("--value",     type=float, help="PO value USD")
    p.add_argument("--seq",       type=int, default=1)
    p.add_argument("--list",      action="store_true")
    args = p.parse_args()

    if args.list:
        print("Available category codes:")
        for k in CATEGORY_DESCRIPTIONS:
            print(f"  {k}")
        return

    if not all([args.category, args.supplier, args.value]):
        print("Usage: python3 contract_template_generator.py --category CODE --supplier NAME --value AMOUNT")
        print("       python3 contract_template_generator.py --list")
        return

    po = generate_po(args.category.upper(), args.supplier, args.value, args.seq)
    out_dir = ROOT / "contracts/drafts"
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = f"TWP-{date.today().year}-{args.seq:04d}_{args.category.upper()}_{args.supplier.replace(' ','_')[:20]}.txt"
    out   = out_dir / fname
    out.write_text(po)
    print(f"PO template generated: {out}")
    print(po[:500] + "...")


if __name__ == "__main__":
    main()
