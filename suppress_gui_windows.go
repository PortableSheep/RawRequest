//go:build windows

package main

import (
	"os"
	"syscall"
)

var (
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procAttachConsole = kernel32.NewProc("AttachConsole")
)

// suppressGUI ensures CLI output works for Windows GUI-subsystem builds.
// If the parent set up pipe handles (e.g. PowerShell output capture) we
// keep them; otherwise we attach to the parent console.
func suppressGUI() {
	// Check whether stdout is already a valid handle (pipe redirect).
	stdout, _ := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE)
	needConsole := stdout == 0 || stdout == syscall.InvalidHandle

	if needConsole {
		const attachParentProcess = ^uint32(0) // ATTACH_PARENT_PROCESS (-1)
		r, _, _ := procAttachConsole.Call(uintptr(attachParentProcess))
		if r == 0 {
			return // no parent console to attach to
		}
	}

	// Reopen standard handles so Go uses the current (pipe or console) handles.
	if h, err := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE); err == nil && h != 0 && h != syscall.InvalidHandle {
		os.Stdout = os.NewFile(uintptr(h), "/dev/stdout")
	}
	if h, err := syscall.GetStdHandle(syscall.STD_ERROR_HANDLE); err == nil && h != 0 && h != syscall.InvalidHandle {
		os.Stderr = os.NewFile(uintptr(h), "/dev/stderr")
	}
	if h, err := syscall.GetStdHandle(syscall.STD_INPUT_HANDLE); err == nil && h != 0 && h != syscall.InvalidHandle {
		os.Stdin = os.NewFile(uintptr(h), "/dev/stdin")
	}
}
