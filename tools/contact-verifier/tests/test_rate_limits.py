"""
Test: Rate limit and backoff logic.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from rate_limits import ProviderGuard


def test_disabled_after_max_failures():
    guard = ProviderGuard("test_provider")
    guard.max_failures = 2

    def failing_fn():
        raise ValueError("simulated failure")

    guard.call(failing_fn)
    guard.call(failing_fn)

    assert guard.stats.disabled, "Provider should be disabled after max_failures"
    assert guard.stats.disable_reason


def test_disabled_provider_not_called():
    guard = ProviderGuard("test_provider")
    guard.stats.disabled = True

    called = []
    def fn():
        called.append(True)

    result = guard.call(fn)
    assert result is None
    assert not called, "Disabled provider must not be called"


def test_quota_exhausted():
    guard = ProviderGuard("test_provider")
    guard.stats.attempted = guard.max_calls

    called = []
    def fn():
        called.append(True)

    result = guard.call(fn)
    assert result is None
    assert not called


def test_successful_call_counted():
    guard = ProviderGuard("test_provider")
    result = guard.call(lambda: "ok")
    assert result == "ok"
    assert guard.stats.successful == 1
    assert guard.stats.attempted == 1
    assert guard.stats.failed == 0


def test_no_infinite_loop():
    """Provider that always fails must stop after max_retries, not loop forever."""
    guard = ProviderGuard("test_provider")
    guard.max_retries = 2

    call_count = [0]
    def failing_fn():
        call_count[0] += 1
        raise ConnectionError("network fail")

    guard.call(failing_fn)
    assert call_count[0] <= guard.max_retries + 1, "Must not exceed max_retries + 1 calls"


if __name__ == "__main__":
    test_disabled_after_max_failures()
    test_disabled_provider_not_called()
    test_quota_exhausted()
    test_successful_call_counted()
    test_no_infinite_loop()
    print("test_rate_limits: ALL PASSED")
