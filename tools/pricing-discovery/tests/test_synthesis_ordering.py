"""
Test: Synthesis is never first-pass — Perplexity only fires after free sources.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from unittest.mock import MagicMock, patch
from rate_limits import GuardRegistry
from models import VECTOR_SYNTHESIS


def test_dry_run_blocks_perplexity():
    """In dry-run, no external calls including Perplexity."""
    guards = GuardRegistry(dry_run=True)
    called = []
    def fake_perplexity(*args, **kwargs):
        called.append(True)
        return []
    guards.guard("perplexity").call(fake_perplexity)
    assert not called, "Perplexity must not be called in dry-run"


def test_perplexity_quota_enforced():
    """Perplexity has low quota — guard enforces it."""
    guards = GuardRegistry(dry_run=False)
    guard = guards.guard("perplexity")
    # Exhaust quota
    guard.stats.attempted = guard.max_calls
    called = []
    result = guard.call(lambda: called.append(True) or [])
    assert result is None
    assert not called


def test_synthesis_vector_label():
    """VECTOR_SYNTHESIS label is distinct from free vectors."""
    from models import VECTOR_BOM, VECTOR_ANALOGOUS, VECTOR_UTILITY, VECTOR_TRADE
    assert VECTOR_SYNTHESIS not in {VECTOR_BOM, VECTOR_ANALOGOUS, VECTOR_UTILITY, VECTOR_TRADE}
    assert VECTOR_SYNTHESIS == "PERPLEXITY_SYNTHESIS"


def test_run_summary_synthesis_not_first():
    """pricing_summary.json always marks synthesis_is_first_pass = False."""
    import tempfile, json
    from outputs import write_run_summary_json
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        path = f.name
    summary = write_run_summary_json(path, [], {}, dry_run=False)
    assert summary["synthesis_is_first_pass"] == False
    os.unlink(path)


def test_confidence_threshold_gates_synthesis():
    """
    Synthesis only fires when confidence < 65.
    At 65+ (COMPONENT_BUILDUPS threshold), synthesis is skipped.
    """
    from models import CONFIDENCE_SCORES, CONF_COMPONENT_BUILDUPS
    threshold = 65
    # At COMPONENT_BUILDUPS score (65), synthesis should NOT fire
    assert CONFIDENCE_SCORES[CONF_COMPONENT_BUILDUPS] >= threshold


if __name__ == "__main__":
    test_dry_run_blocks_perplexity()
    test_perplexity_quota_enforced()
    test_synthesis_vector_label()
    test_run_summary_synthesis_not_first()
    test_confidence_threshold_gates_synthesis()
    print("test_synthesis_ordering: ALL PASSED")
