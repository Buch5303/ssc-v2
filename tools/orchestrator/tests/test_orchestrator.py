"""
Tests for the multi-agent orchestrator.
All tests are mocked — no live API calls.
"""
import sys, os, json, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from unittest.mock import MagicMock, patch
from config.loop_config import MAX_CORRECTION_PASSES


def test_architect_plan_structure():
    """Architect output must have required fields."""
    required = ["directive_id", "title", "objective", "research_queries",
                "build_spec", "acceptance_criteria", "audit_scope"]
    plan = {
        "directive_id": "D55-001",
        "title": "Test",
        "objective": "Test objective",
        "research_queries": [],
        "build_spec": {"files_to_create": [], "implementation_notes": "", "constraints": []},
        "acceptance_criteria": ["Tests pass"],
        "audit_scope": "Unit tests",
        "estimated_complexity": "LOW",
    }
    for field in required:
        assert field in plan, f"Missing: {field}"


def test_architect_unavailable_without_key():
    from agents.architect import ArchitectAgent
    with patch.dict(os.environ, {}, clear=True):
        agent = ArchitectAgent()
        assert not agent.available()


def test_researcher_unavailable_without_key():
    from agents.researcher import ResearcherAgent
    with patch.dict(os.environ, {}, clear=True):
        agent = ResearcherAgent()
        assert not agent.available()


def test_researcher_returns_empty_when_unavailable():
    from agents.researcher import ResearcherAgent
    with patch.dict(os.environ, {}, clear=True):
        agent = ResearcherAgent()
        results = agent.research(["test query"])
        assert results == []


def test_builder_unavailable_without_key():
    from agents.builder import BuilderAgent
    with patch.dict(os.environ, {}, clear=True):
        agent = BuilderAgent()
        assert not agent.available()


def test_auditor_graceful_degradation():
    """Auditor without key returns CONDITIONAL_PASS with LOW confidence."""
    from agents.auditor import AuditorAgent
    with patch.dict(os.environ, {}, clear=True):
        agent = AuditorAgent()
        result = agent.audit(
            build_output={"status": "COMPLETE", "files": []},
            acceptance_criteria=["Tests pass"],
            audit_scope="Unit tests",
            directive_id="D55-001",
        )
    assert result["verdict"] == "CONDITIONAL_PASS"
    assert result["confidence"] == "LOW"


def test_directive_queue_loads():
    from state.directive_queue import DirectiveQueue
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump({"directives": [
            {"id": "D1", "title": "Test", "task": "Do something",
             "priority": 1, "depends_on": [], "context": ""},
        ]}, f)
        path = f.name
    queue = DirectiveQueue(path)
    assert len(queue.directives) == 1
    assert queue.directives[0].id == "D1"
    os.unlink(path)


def test_directive_queue_dependency_respected():
    from state.directive_queue import DirectiveQueue
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump({"directives": [
            {"id": "D1", "title": "First", "task": "First task",
             "priority": 1, "depends_on": [], "context": ""},
            {"id": "D2", "title": "Second", "task": "Second task",
             "priority": 2, "depends_on": ["D1"], "context": ""},
        ]}, f)
        path = f.name
    queue = DirectiveQueue(path)

    # D2 should not be returned until D1 is complete
    next_d = queue.next(completed_ids=[])
    assert next_d.id == "D1"

    next_d = queue.next(completed_ids=["D1"])
    assert next_d.id == "D2"

    # Nothing left when both complete
    assert queue.next(completed_ids=["D1", "D2"]) is None
    os.unlink(path)


def test_state_manager_persists():
    from state.session_state import StateManager
    import uuid
    path = f"/tmp/test_state_{uuid.uuid4().hex[:8]}.json"
    # Don't pre-create — StateManager creates it on first save
    sm = StateManager(path)
    ds = sm.get_or_create_directive("D1", "Test directive")
    assert ds.directive_id == "D1"
    assert ds.status == "QUEUED"

    sm.mark_complete("D1", "abc1234")
    assert sm.state.completed_count == 1

    # Reload and verify persistence
    sm2 = StateManager(path)
    completed = [d for d in sm2.state.directives if d.directive_id == "D1"]
    assert completed[0].status == "COMPLETE"
    assert completed[0].commit_sha == "abc1234"
    os.unlink(path)


def test_audit_log_writes_jsonl():
    from state.audit_log import AuditLog
    with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w") as f:
        path = f.name
    al = AuditLog(path)
    al.log_directive_start("D1", "Test")
    al.log_audit_result("D1", "PASS", [], 1)
    al.log_directive_complete("D1", "abc1234", 1)

    with open(path) as f:
        lines = [json.loads(l) for l in f.readlines()]

    assert len(lines) == 3
    assert lines[0]["event"] == "DIRECTIVE_START"
    assert lines[1]["event"] == "AUDIT_RESULT"
    assert lines[2]["event"] == "DIRECTIVE_COMPLETE"
    os.unlink(path)


def test_file_writer_blocks_non_tools_paths():
    from outputs.file_writer import write_build_output
    build_output = {
        "status": "COMPLETE",
        "files": [
            {"path": "frontend/app/page.tsx", "action": "MODIFY",
             "content": "// should be blocked"},
            {"path": "tools/test_file.py", "action": "CREATE",
             "content": "# safe"},
        ]
    }
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create tools dir
        os.makedirs(os.path.join(tmpdir, "tools"), exist_ok=True)
        count, paths = write_build_output(build_output, repo_root=tmpdir)
    # Only tools/ file should be written, frontend blocked
    assert count == 1
    assert all("tools/" in p for p in paths)


def test_researcher_format_for_builder():
    from agents.researcher import ResearcherAgent
    agent = ResearcherAgent()
    results = [
        {
            "query": "W251 BOP cost",
            "findings": [{"finding": "$9M BOP estimate", "source": "FERC", "confidence": "HIGH", "citation": "https://ferc.gov"}],
            "summary": "BOP costs approximately $9M",
            "data_gaps": [],
        }
    ]
    formatted = agent.format_for_builder(results)
    assert "W251 BOP cost" in formatted
    assert "$9M BOP estimate" in formatted


def test_max_correction_passes_config():
    """Verify MAX_CORRECTION_PASSES is set to a sane limit."""
    assert 1 <= MAX_CORRECTION_PASSES <= 5, "MAX_CORRECTION_PASSES should be 1-5"


if __name__ == "__main__":
    test_architect_plan_structure()
    test_architect_unavailable_without_key()
    test_researcher_unavailable_without_key()
    test_researcher_returns_empty_when_unavailable()
    test_builder_unavailable_without_key()
    test_auditor_graceful_degradation()
    test_directive_queue_loads()
    test_directive_queue_dependency_respected()
    test_state_manager_persists()
    test_audit_log_writes_jsonl()
    test_file_writer_blocks_non_tools_paths()
    test_researcher_format_for_builder()
    test_max_correction_passes_config()
    print("test_orchestrator: ALL PASSED")
