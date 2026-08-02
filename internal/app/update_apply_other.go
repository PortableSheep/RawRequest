//go:build !windows

package app

import "os/exec"

// startUpdaterProcess launches the updater helper. Non-Windows platforms
// don't have Windows Job Object kill-on-close semantics, so a plain Start
// is sufficient.
func startUpdaterProcess(cmd *exec.Cmd) error {
	return cmd.Start()
}
