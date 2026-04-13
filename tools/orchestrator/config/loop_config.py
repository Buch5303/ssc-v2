"""
config/loop_config.py — Loop control and timeout configuration.
"""

# Max correction passes before escalating to human
MAX_CORRECTION_PASSES = 3

# Max tokens per agent call
MAX_TOKENS = {
    "architect":  4096,
    "researcher": 2048,
    "builder":    8192,
    "auditor":    4096,
}

# Models
MODELS = {
    "architect":  "gpt-4o",
    "researcher": "sonar-pro",           # Perplexity online model
    "builder":    "claude-opus-4-5",     # Claude Opus 4.5
    "auditor":    "grok-3",              # xAI Grok 3
}

# API base URLs
API_URLS = {
    "architect":  "https://api.openai.com/v1/chat/completions",
    "researcher": "https://api.perplexity.ai/chat/completions",
    "builder":    "https://api.anthropic.com/v1/messages",
    "auditor":    "https://api.x.ai/v1/chat/completions",
}

# Timeouts (seconds)
TIMEOUTS = {
    "architect":  60,
    "researcher": 45,
    "builder":    180,   # builder needs more time for code generation
    "auditor":    90,
}

# Retry config
MAX_RETRIES     = 3
BACKOFF_BASE    = 2.0
BACKOFF_CAP     = 30.0

# Context window limits (chars) — summarize if exceeded
CONTEXT_LIMIT = 50_000

# Git config
AUTO_COMMIT   = True
AUTO_PUSH     = True
BRANCH        = "frontend-only"

# Directive queue file
DIRECTIVE_QUEUE_FILE = "directive_queue.json"

# Session state file
SESSION_STATE_FILE   = "session_state.json"

# Audit log file
AUDIT_LOG_FILE       = "audit_log.jsonl"

# Locked baseline — never regress
LOCKED_UI_BASELINE   = "2111282"
