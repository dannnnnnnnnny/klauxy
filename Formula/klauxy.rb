# Homebrew formula for Klauxy.
#
# Publish flow:
#   1. npm publish            (the formula installs the published tarball)
#   2. npm view klauxy dist.tarball dist.integrity
#   3. update url + sha256 below, then push to a homebrew-<name> tap repo
#
# Install:
#   brew tap OWNER/tap && brew install klauxy
class Klauxy < Formula
  desc "Transparent Korean-to-English prompt translation for Claude Code"
  homepage "https://github.com/OWNER/klauxy"
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
    assert_match "Klauxy providers", shell_output("#{bin}/klx provider")
  end
end
