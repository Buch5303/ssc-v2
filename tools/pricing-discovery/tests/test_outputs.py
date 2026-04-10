import sys, os, csv, json, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from outputs import write_pricing_csv, write_pricing_summary_md, write_run_summary_json

SAMPLE = [
    {"category": "Vibration Monitoring", "category_code": "VIB_MON",
     "low_usd": 160000, "mid_usd": 220000, "high_usd": 300000,
     "confidence_label": "COMPONENT_BUILDUPS", "confidence_score": 65,
     "primary_vector": "COMPONENT_BOM", "evidence_count": 3,
     "bom_total_mid": 215000, "analogous_refs": "GE Frame 6B",
     "data_year": 2024, "cost_index": "ENR CCI 2024",
     "prior_mid_usd": 210000, "delta_pct": 2.4,
     "notes": "", "last_updated": "2026-01-01T00:00:00Z", "evidence_json": "[]"},
]

def test_csv_written():
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as f: path = f.name
    write_pricing_csv(path, SAMPLE)
    with open(path) as f: rows = list(csv.DictReader(f))
    assert len(rows) == 1
    assert rows[0]["category"] == "Vibration Monitoring"
    os.unlink(path)

def test_summary_md_written():
    with tempfile.NamedTemporaryFile(suffix=".md", delete=False) as f: path = f.name
    write_pricing_summary_md(path, SAMPLE)
    content = open(path).read()
    assert "220,000" in content or "220000" in content.replace(",", "")
    os.unlink(path)

def test_run_summary_json():
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f: path = f.name
    summary = write_run_summary_json(path, SAMPLE, {}, dry_run=False)
    assert summary["total_categories"] == 1
    assert summary["total_bop_mid"] == 220000
    os.unlink(path)

if __name__ == "__main__":
    test_csv_written()
    test_summary_md_written()
    test_run_summary_json()
    print("test_outputs: ALL PASSED")
