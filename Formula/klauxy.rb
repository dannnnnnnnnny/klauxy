# Homebrew formula for Klauxy.
#
# Publish flow:
#   1. npm publish                        (the formula installs that tarball)
#   2. npm run formula:update             (rewrites url + sha256 below)
#   3. copy this file into a homebrew-tap repo and push
#
# Install:
#   brew tap dannnnnnnnnny/tap && brew install klauxy
class Klauxy < Formula
  desc "Transparent Korean-to-English prompt translation for Claude Code"
  homepage "https://github.com/dannnnnnnnnny/klauxy"
  url "https://registry.npmjs.org/klauxy/-/klauxy-0.1.0.tgz"
  sha256 "REPLACE_WITH_SHA256_OF_PUBLISHED_TARBALL"
  license "MIT"

  depends_on "node"

  # Klauxy manages its own LaunchAgent through `klx install`, so this formula
  # deliberately omits a `service` block. Two supervisors for one proxy would
  # fight over the same port.
  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~EOS
      Klauxy needs a local model server and a one-time setup:

        klx init      # choose oMLX, Ollama, or OpenCode
        klx install   # wrap the claude command
        klx on        # start translating

      Claude Code must already be installed and on your PATH.
      Run `klx doctor` to check the setup.
    EOS
  end

  test do
    # Both entry points must resolve, and the version must match the formula.
    assert_match version.to_s, shell_output("#{bin}/klx --version")
    assert_match version.to_s, shell_output("#{bin}/klauxy --version")

    # Point HOME at the sandbox so the test never reads or writes real config.
    ENV["HOME"] = testpath
    assert_match "Usage:", shell_output("#{bin}/klx --help")
    assert_match "omlx", shell_output("#{bin}/klx provider")

    # An unknown command must fail rather than exit 0.
    shell_output("#{bin}/klx not-a-command 2>&1", 1)
  end
end
