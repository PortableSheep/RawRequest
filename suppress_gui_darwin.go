//go:build darwin && cgo

package main

// suppressGUI is intentionally a no-op on macOS.
//
// Earlier versions instantiated NSApplication and set
// NSApplicationActivationPolicyProhibited so that headless CLI/MCP/service
// runs would not show a dock icon. The unintended side effect was that the
// very act of materializing [NSApplication sharedApplication] registered the
// headless process with Cocoa/LaunchServices under the same code-signing
// identifier as the GUI bundle. With a long-lived child like `rawrequest mcp`
// alive, subsequent GUI launches of RawRequest.app were routed by
// LaunchServices to the headless instance and timed out with
// "RawRequest is not open anymore."
//
// CLI/MCP/service modes are pure stdio Go programs and have no need to touch
// Cocoa at all. Skipping NSApplication entirely keeps macOS from associating
// these processes with the bundle in the first place.
func suppressGUI() {}
