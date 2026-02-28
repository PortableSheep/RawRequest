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

// suppressGUI attaches to the parent process console so that CLI output
// (fmt.Printf, etc.) reaches the calling terminal on Windows GUI-subsystem builds.
func suppressGUI() {
	const attachParentProcess = ^uint32(0) // ATTACH_PARENT_PROCESS (-1)
	r, _, _ := procAttachConsole.Call(uintptr(attachParentProcess))
	if r == 0 {
		return // no parent console to attach to
	}
	// Reopen standard handles to use the attached console
	if h, err := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE); err == nil {
		os.Stdout = os.NewFile(uintptr(h), "/dev/stdout")
	}
	if h, err := syscall.GetStdHandle(syscall.STD_ERROR_HANDLE); err == nil {
		os.Stderr = os.NewFile(uintptr(h), "/dev/stderr")
	}
	if h, err := syscall.GetStdHandle(syscall.STD_INPUT_HANDLE); err == nil {
		os.Stdin = os.NewFile(uintptr(h), "/dev/stdin")
	}
}
