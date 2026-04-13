"""
comparable_machines.py — FlowSeer Pricing Discovery Engine
Directive 53 — Analogous Gas Turbine Cross-Reference + Cost Normalization

Normalizes BOP costs from comparable GT machines to W251B8 (50MW class).
Uses:
  - MW capacity scaling
  - ENR Construction Cost Index for year normalization
  - Technology class adjustments (simple cycle vs combined)
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

# ── ENR Construction Cost Index (CCI) ────────────────────────────────────────
# Base year 2024 = 100. Historical values for normalization.
ENR_CCI: Dict[int, float] = {
    2010: 64.2,
    2011: 66.8,
    2012: 67.5,
    2013: 68.5,
    2014: 70.1,
    2015: 70.8,
    2016: 71.2,
    2017: 72.5,
    2018: 75.0,
    2019: 77.2,
    2020: 77.8,
    2021: 84.5,
    2022: 93.6,
    2023: 97.8,
    2024: 100.0,
    2025: 102.5,
    2026: 105.0,  # estimate
}


def normalize_to_current(value_usd: float, data_year: int, target_year: int = 2024) -> Tuple[float, str]:
    """
    Escalate a historical cost to current year dollars using ENR CCI.
    Returns (escalated_value, index_label).
    """
    base_cci   = ENR_CCI.get(data_year, ENR_CCI[2024])
    target_cci = ENR_CCI.get(target_year, ENR_CCI[2024])
    factor     = target_cci / base_cci
    return value_usd * factor, f"ENR CCI {data_year}→{target_year} ({factor:.3f}x)"


def normalize_by_mw(value_usd: float, source_mw: float, target_mw: float = 50.0) -> Tuple[float, float]:
    """
    Scale cost from source machine to target machine by MW.
    Uses 0.7 power law (economies of scale in industrial equipment).
    Returns (scaled_value, scale_factor).
    """
    if source_mw <= 0 or target_mw <= 0:
        return value_usd, 1.0
    factor = (target_mw / source_mw) ** 0.7
    return value_usd * factor, factor


# ── Comparable machine database ───────────────────────────────────────────────
# Each entry: machine_id → {name, mw, manufacturer, tech_class, notes}

COMPARABLE_MACHINES: Dict[str, dict] = {
    "GE_6B": {
        "name": "GE Frame 6B",
        "mw": 42.0,
        "manufacturer": "GE",
        "tech_class": "simple_cycle",
        "notes": "Extensively documented in US utility rate cases 1995-2015. W251-class equivalent.",
        "search_terms": [
            '"Frame 6B" "BOP" cost OR price',
            '"Frame 6B" "balance of plant" FERC cost',
            '"GE Frame 6" peaker BOP cost',
            '"6B" gas turbine capital cost utility filing',
            'FERC "Frame 6B" plant cost',
        ],
        "ferc_plant_accounts": "Account 311-316",
        "typical_bop_usd_per_kw": (180, 220, 280),  # low/mid/high $/kW for BOP only
        "data_year_range": (2005, 2020),
    },
    "GE_7EA": {
        "name": "GE Frame 7EA",
        "mw": 87.0,
        "manufacturer": "GE",
        "tech_class": "simple_cycle",
        "notes": "Most common US peaker. Abundant FERC Form 1 data. Scale down to W251.",
        "search_terms": [
            '"Frame 7EA" "BOP" cost OR price',
            '"7EA" gas turbine BOP FERC cost',
            '"GE Frame 7" peaker capital cost',
            '"7EA" "balance of plant" utility filing',
        ],
        "ferc_plant_accounts": "Account 311-316",
        "typical_bop_usd_per_kw": (160, 200, 260),
        "data_year_range": (2000, 2022),
    },
    "SIEMENS_SGT600": {
        "name": "Siemens SGT-600",
        "mw": 25.0,
        "manufacturer": "Siemens",
        "tech_class": "simple_cycle",
        "notes": "25MW industrial GT. European procurement records available.",
        "search_terms": [
            '"SGT-600" BOP cost OR price',
            '"SGT 600" "balance of plant" cost',
            '"Siemens SGT" 25MW BOP installation cost',
        ],
        "ferc_plant_accounts": "N/A (non-US)",
        "typical_bop_usd_per_kw": (200, 250, 320),
        "data_year_range": (2010, 2023),
    },
    "SOLAR_TITAN130": {
        "name": "Solar Turbines Titan 130",
        "mw": 15.0,
        "manufacturer": "Solar Turbines (Caterpillar)",
        "tech_class": "simple_cycle",
        "notes": "Common in industrial cogen. BOP scope well-documented in EPC bid packages.",
        "search_terms": [
            '"Titan 130" BOP cost',
            '"Solar Titan" "balance of plant" cost',
            '"Titan 130" installation cost filetype:pdf',
        ],
        "ferc_plant_accounts": "Account 311-316",
        "typical_bop_usd_per_kw": (220, 275, 350),
        "data_year_range": (2012, 2023),
    },
    "RR_RB211": {
        "name": "Rolls-Royce RB211-GT61",
        "mw": 32.0,
        "manufacturer": "Rolls-Royce",
        "tech_class": "simple_cycle",
        "notes": "Offshore and industrial use. BOP documented in UK platform engineering studies.",
        "search_terms": [
            '"RB211" BOP cost OR price',
            '"RB211" "balance of plant" installation',
            '"Rolls-Royce RB211" gas turbine BOP cost filetype:pdf',
        ],
        "ferc_plant_accounts": "N/A",
        "typical_bop_usd_per_kw": (210, 265, 340),
        "data_year_range": (2008, 2022),
    },
    "W251_SELF": {
        "name": "Westinghouse/Siemens W251B8 (self)",
        "mw": 50.0,
        "manufacturer": "Siemens Energy",
        "tech_class": "simple_cycle",
        "notes": "Target machine. 50MW simple cycle. Any direct W251 references are gold.",
        "search_terms": [
            '"W251" BOP cost OR price',
            '"W251B8" "balance of plant"',
            '"W251" gas turbine installation cost',
            '"251B8" EPC cost',
            '"Westinghouse 251" power plant cost',
        ],
        "ferc_plant_accounts": "Account 311-316",
        "typical_bop_usd_per_kw": (190, 240, 310),
        "data_year_range": (2000, 2026),
    },
}


def normalize_machine_bop(
    machine_id: str,
    raw_total_bop_usd: float,
    data_year: int,
    target_mw: float = 50.0,
    target_year: int = 2024,
) -> Tuple[float, float, str, str]:
    """
    Normalize a comparable machine's BOP cost to W251 class.
    Returns: (low_estimate, high_estimate, scale_note, index_note)
    """
    machine = COMPARABLE_MACHINES.get(machine_id)
    if not machine:
        return raw_total_bop_usd, raw_total_bop_usd, "", ""

    # Step 1: Escalate to current year
    escalated, index_note = normalize_to_current(raw_total_bop_usd, data_year, target_year)

    # Step 2: Scale by MW
    scaled, scale_factor = normalize_by_mw(escalated, machine["mw"], target_mw)

    scale_note = (
        f"{machine['name']} ({machine['mw']}MW → {target_mw}MW, "
        f"0.7 power law, factor={scale_factor:.3f})"
    )

    # Apply ±15% uncertainty band on normalized estimate
    low  = scaled * 0.85
    high = scaled * 1.15

    return low, high, scale_note, index_note


def get_bop_benchmark_from_kw(
    machine_id: str,
    target_mw: float = 50.0,
    target_year: int = 2024,
    midpoint_year: int = 2015,
) -> Tuple[float, float, float, str]:
    """
    Derive BOP estimate from $/kW benchmark data for a comparable machine.
    Returns: (low_usd, mid_usd, high_usd, note)
    """
    machine = COMPARABLE_MACHINES.get(machine_id)
    if not machine:
        return 0, 0, 0, ""

    low_kw, mid_kw, high_kw = machine["typical_bop_usd_per_kw"]
    target_kw = target_mw * 1000

    # Escalate $/kW to current year
    escalation_factor = ENR_CCI.get(target_year, 100) / ENR_CCI.get(midpoint_year, 77.2)

    low  = low_kw  * target_kw * escalation_factor
    mid  = mid_kw  * target_kw * escalation_factor
    high = high_kw * target_kw * escalation_factor

    note = (
        f"{machine['name']}: {low_kw}–{high_kw} $/kW × {target_kw:,}kW "
        f"× ENR escalation {midpoint_year}→{target_year} ({escalation_factor:.3f}x)"
    )
    return low, mid, high, note


def get_all_machine_ids() -> List[str]:
    return list(COMPARABLE_MACHINES.keys())
