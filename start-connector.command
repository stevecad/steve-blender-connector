#!/bin/sh
# Manual macOS launcher. Close with Ctrl-C in its Terminal window.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22 or newer is required.'
  exit 1
fi
exec node "$ROOT/connector.js"
