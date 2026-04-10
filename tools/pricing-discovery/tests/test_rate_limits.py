import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from rate_limits import ProviderGuard, GuardRegistry

def test_dry_run_blocks_all():
    g = GuardRegistry(dry_run=True)
    called = []
    for name in ["google_catalog", "usaspending", "ferc_form1", "perplexity"]:
        result = g.guard(name).call(lambda: called.append(True) or "result")
    assert not called

def test_quota_exhausted():
    guard = ProviderGuard("test")
    guard.stats.attempted = guard.max_calls
    result = guard.call(lambda: "should not run")
    assert result is None

def test_disabled_after_failures():
    guard = ProviderGuard("test"); guard.max_failures = 2
    for _ in range(3):
        guard.call(lambda: (_ for _ in ()).throw(ValueError("fail")))
    assert guard.stats.disabled

def test_successful_call():
    guard = ProviderGuard("test")
    result = guard.call(lambda: 42)
    assert result == 42
    assert guard.stats.successful == 1

if __name__ == "__main__":
    test_dry_run_blocks_all()
    test_quota_exhausted()
    test_successful_call()
    print("test_rate_limits: ALL PASSED")
