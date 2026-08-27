#!/bin/sh
# Klauxy installer.
#
#   curl -fsSL https://raw.githubusercontent.com/OWNER/klauxy/main/install.sh | sh
#
# Installs the published npm package globally, then hands off to `klx install`
# which creates the claude shim and the LaunchAgent.
set -eu

PACKAGE="klauxy"

die() {
  echo "klauxy: $1" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || die "macOS is required (found $(uname -s))"

command -v node >/dev/null 2>&1 || die "Node.js 20+ is required. Install it first: https://nodejs.org"
command -v npm >/dev/null 2>&1 || die "npm is required and is normally bundled with Node.js"

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20 or newer is required (found $(node -v))"

command -v claude >/dev/null 2>&1 ||
  echo "klauxy: warning: the claude command was not found on PATH; install Claude Code before running klx install" >&2

echo "Installing $PACKAGE globally..."
npm install -g "$PACKAGE" || die "npm install failed"

command -v klx >/dev/null 2>&1 ||
  die "klx is not on PATH after installation; check your npm global bin directory"

echo ""
echo "Installed. Next steps:"
echo ""
echo "  klx init      # choose oMLX, Ollama, or OpenCode"
echo "  klx install   # wrap the claude command"
echo "  klx on        # start translating"
echo ""
echo "Run klx doctor if anything looks wrong."
