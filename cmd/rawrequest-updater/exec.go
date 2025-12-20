package main

import "os/exec"

// execCommand exists to keep command creation isolated for future testing.
func execCommand(name string, args ...string) *exec.Cmd {
	return exec.Command(name, args...)
}
