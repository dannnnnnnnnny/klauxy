#!/bin/sh
# Klauxy installer.
#
#   curl -fsSL https://raw.githubusercontent.com/dannnnnnnnnny/klauxy/HEAD/install.sh | sh
#
# Pin a version with KLAUXY_VERSION:
#   curl -fsSL .../install.sh | KLAUXY_VERSION=0.1.0 sh
#
# Installs the published npm package globally, then hands off to `klx install`
# which creates the claude shim and registers the proxy service.
set -eu

PACKAGE="klauxy"
VERSION="${KLAUXY_VERSION:-latest}"

die() {
  echo "klauxy: $1" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin | Linux) ;;
  *) die "macOS or Linux is required (found $(uname -s))" ;;
esac

command -v node >/dev/null 2>&1 || die "Node.js 20+ is required. Install it first: https://nodejs.org"
command -v npm >/dev/null 2>&1 || die "npm is required and is normally bundled with Node.js"

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20 or newer is required (found $(node -v))"

command -v claude >/dev/null 2>&1 ||
  echo "klauxy: warning: the claude command was not found on PATH; install Claude Code before running klx install" >&2

echo "Installing $PACKAGE@$VERSION globally..."
npm install -g "$PACKAGE@$VERSION" ||
  die "npm install failed. For a permission error see https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally"

command -v klx >/dev/null 2>&1 ||
  die "klx is not on PATH after installation; check your npm global bin directory (npm prefix -g)"

echo ""
echo "Installed klx $(klx --version)"
echo ""
echo "Next steps:"
echo ""
echo "  klx init      # choose oMLX, Ollama, or any OpenAI-compatible server"
echo "  klx install   # wrap the claude command"
echo "  klx on        # start translating"
echo ""
echo "Run klx doctor if anything looks wrong."
