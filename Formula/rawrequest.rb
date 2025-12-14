# typed: false
# frozen_string_literal: true

# Homebrew formula for RawRequest
# To install from this repo directly:
#   brew install --formula ./Formula/rawrequest.rb
#
# Or tap this repo:
#   brew tap portablesheep/rawrequest https://github.com/portablesheep/RawRequest
#   brew install rawrequest

class Rawrequest < Formula
  desc "A modern, lightweight HTTP client for developers"
  homepage "https://github.com/portablesheep/RawRequest"
  version "1.0.0"
  license "MIT"

  # Update these URLs when releasing
  # The sha256 will be output by the package_homebrew.sh script
  if OS.mac?
    if Hardware::CPU.arm?
      url "https://github.com/portablesheep/RawRequest/releases/download/v#{version}/RawRequest-v#{version}-macos-universal.tar.gz"
      sha256 "7336f34292ba7739c25e09304dee7ef9a444df39e56a9caabc9d2a882527271b"
    else
      url "https://github.com/portablesheep/RawRequest/releases/download/v#{version}/RawRequest-v#{version}-macos-universal.tar.gz"
      sha256 "7336f34292ba7739c25e09304dee7ef9a444df39e56a9caabc9d2a882527271b"
    end
  end

  def install
    # Install the app bundle to the prefix
    prefix.install "RawRequest.app"
    
    # Create a symlink in bin for CLI access (optional)
    if File.exist?("rawrequest")
      bin.install "rawrequest"
    end
  end

  def caveats
    <<~EOS
      RawRequest.app has been installed to:
        #{prefix}/RawRequest.app

      To open RawRequest, you can:
        1. Run: open #{prefix}/RawRequest.app
        2. Or add it to your Applications folder:
           ln -sf #{prefix}/RawRequest.app /Applications/RawRequest.app

      On first launch, macOS may show a security warning.
      Go to System Preferences > Security & Privacy to allow the app.
    EOS
  end

  test do
    # Basic test to verify the app bundle exists
    assert_predicate prefix/"RawRequest.app", :exist?
  end
end
