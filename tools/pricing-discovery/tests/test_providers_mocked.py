"""
Test: Provider adapters with mocked HTTP — deterministic, no live API calls.
"""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from unittest.mock import MagicMock, patch
from models import CONF_PUBLIC_CONTRACT, CONF_MARKET_ANCHOR, CONF_EIA_BENCHMARK


def make_mock_session(json_response: dict, status_code: int = 200):
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = json_response
    mock_resp.raise_for_status = MagicMock()
    session = MagicMock()
    session.get.return_value = mock_resp
    session.post.return_value = mock_resp
    return session


def test_usaspending_parses_award():
    from providers.sam_gov import search_usaspending
    session = make_mock_session({
        "results": [{
            "Award ID": "DAAA09-22-C-1234",
            "Recipient Name": "Baker Hughes",
            "Award Amount": "340000",
            "Description": "Vibration monitoring gas turbine",
            "Period of Performance Start Date": "2022-03-01",
            "Awarding Agency Name": "Dept of Energy",
            "NAICS Code": "333611",
        }]
    })
    results = search_usaspending(session, ["vibration", "gas turbine"], "Vibration Monitoring")
    assert len(results) == 1
    assert results[0].raw_value_usd == 340_000
    assert results[0].confidence_label == CONF_PUBLIC_CONTRACT


def test_usaspending_filters_tiny_awards():
    from providers.sam_gov import search_usaspending
    session = make_mock_session({
        "results": [{"Award Amount": "500", "Award ID": "x", "Recipient Name": "x",
                     "Description": "tiny", "Period of Performance Start Date": "2022-01-01",
                     "Awarding Agency Name": "x", "NAICS Code": "x"}]
    })
    results = search_usaspending(session, ["gas turbine"], "Test")
    assert len(results) == 0  # <$10K filtered out


def test_eia_benchmark_always_returns():
    from providers.ferc import eia_form860_benchmark
    session = make_mock_session({})  # EIA is internal — session not used
    results = eia_form860_benchmark(session, "Vibration Monitoring", 50.0)
    assert len(results) == 1
    assert results[0].confidence_label == CONF_EIA_BENCHMARK
    assert results[0].normalized_value_usd > 0


def test_google_catalog_extracts_dollar_amounts():
    from providers.supplier_catalogs import google_catalog_search
    session = make_mock_session({
        "items": [{
            "title": "Bently Nevada 3500 Vibration Monitor",
            "snippet": "Budgetary price $48,000 for complete rack system",
            "link": "https://bently.com/products/3500",
        }]
    })
    with patch("providers.supplier_catalogs.GOOGLE_API_KEY", "fake"), \
         patch("providers.supplier_catalogs.GOOGLE_CSE_ID", "fake"):
        results = google_catalog_search(
            session, ['"Bently Nevada" price'], "Vibration Monitoring", ["Bently Nevada"]
        )
    assert len(results) == 1
    assert results[0].raw_value_usd == 48_000


def test_google_catalog_no_key_returns_empty():
    from providers.supplier_catalogs import google_catalog_search
    with patch.dict(os.environ, {}, clear=True):
        session = MagicMock()
        results = google_catalog_search(session, ["test"], "Test", [])
    assert results == []


def test_ferc_form1_benchmark_returns_evidence():
    from providers.ferc import ferc_form1_search
    session = make_mock_session({})
    results = ferc_form1_search(session, ["GE_6B", "GE_7EA"], "Vibration Monitoring")
    assert len(results) >= 1
    for r in results:
        assert r.raw_value_usd > 0


if __name__ == "__main__":
    test_usaspending_parses_award()
    test_usaspending_filters_tiny_awards()
    test_eia_benchmark_always_returns()
    test_google_catalog_extracts_dollar_amounts()
    test_google_catalog_no_key_returns_empty()
    test_ferc_form1_benchmark_returns_evidence()
    print("test_providers_mocked: ALL PASSED")
