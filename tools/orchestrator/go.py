#!/usr/bin/env python3
"""
go.py — One-command orchestrator reset and launch.
Run: python3 go.py
Does everything: git sync, session reset, starts loop.
"""
import subprocess, json, sys, os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

print("Step 1: Syncing git...")
subprocess.run(["git", "fetch", "origin"], cwd="../..", capture_output=True)
subprocess.run(["git", "reset", "--hard", "origin/frontend-only"], cwd="../..")

print("Step 2: Resetting session...")
state = {
    "session_id": "d58",
    "started_at": "2026-04-11T00:00:00+00:00",
    "last_updated": "2026-04-11T00:00:00+00:00",
    "current_directive": None,
    "completed_count": 0,
    "failed_count": 0,
    "escalated_count": 0,
    "directives": []
}
with open("session_state.json", "w") as f:
    json.dump(state, f, indent=2)

print("Step 3: Starting orchestrator loop...")
os.execv(sys.executable, [sys.executable, "orchestrator.py", "--loop"])
