#!/usr/bin/env bash
# Vercel "Ignored Build Step".
#   exit 1  => BUILD (proceed with deploy)
#   exit 0  => SKIP  (no deploy)
#
# The autonomous loop commits queue bookkeeping and a `data/last_run.json`
# debug snapshot on EVERY cron cycle. Every commit to main otherwise triggers
# a fresh production deploy, so these bookkeeping commits were generating a
# deploy (and, when one errored, a failure notice) every 15 minutes. None of
# data/, tools/ (local-only Python orchestrator), or docs/ can affect the
# deployed Next.js app, so we skip the build when a commit touches ONLY those.

# Vercel clones shallow; make sure we have a parent to diff against.
if ! git rev-parse HEAD^ >/dev/null 2>&1; then
  git fetch --deepen=1 >/dev/null 2>&1 || true
fi
if ! git rev-parse HEAD^ >/dev/null 2>&1; then
  echo "No parent commit available — building to be safe."
  exit 1
fi

CHANGED_OUTSIDE=$(git diff --name-only HEAD^ HEAD -- . ':(exclude)data' ':(exclude)tools' ':(exclude)docs' | head -1)

if [ -z "$CHANGED_OUTSIDE" ]; then
  echo "Only data/, tools/, or docs/ changed — skipping deploy (no app impact)."
  exit 0
fi

echo "Source changes detected ($CHANGED_OUTSIDE ...) — building."
exit 1
