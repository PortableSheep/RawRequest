//go:build windows

package app

import (
	"os/exec"
	"syscall"
)

const (
	// createBreakawayFromJob detaches the new process from any job object
	// the current process belongs to.
	createBreakawayFromJob = 0x01000000
	// createNewProcessGroup ensures the updater isn't tied to our console/
	// process group either, so it keeps running once we quit.
	createNewProcessGroup = 0x00000200
)

// startUpdaterProcess launches the updater helper so it survives this
// process quitting immediately afterward.
//
// GUI apps hosted by WebView2/Chromium on Windows (and many launch paths,
// e.g. terminals, IDEs, service wrappers) run inside a job object with
// "kill all processes on job close" semantics. Without
// CREATE_BREAKAWAY_FROM_JOB, a normally-spawned child inherits that job, so
// the instant we call wailsruntime.Quit() Windows tears down the updater
// helper along with us — the update downloads successfully but is never
// applied because the helper never gets to run.
//
// CreateProcess only honors CREATE_BREAKAWAY_FROM_JOB if the job allows it
// (JOB_OBJECT_LIMIT_BREAKAWAY_OK); otherwise it fails outright. We retry
// without the flag in that case so the update can still proceed best-effort
// (matching the pre-existing behavior for any environment that forbids
// breakaway).
func startUpdaterProcess(cmd *exec.Cmd) error {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: createBreakawayFromJob | createNewProcessGroup,
	}
	if err := cmd.Start(); err != nil {
		cmd.SysProcAttr = nil
		return cmd.Start()
	}
	return nil
}
