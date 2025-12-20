//go:build !windows

package main

import (
	"fmt"
	"syscall"
	"time"
)

func waitForPIDExit(pid int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		if err := syscall.Kill(pid, 0); err != nil {
			// ESRCH => process does not exist
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("waited %s", timeout)
		}
		time.Sleep(200 * time.Millisecond)
	}
}
