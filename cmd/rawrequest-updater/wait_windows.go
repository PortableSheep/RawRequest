//go:build windows

package main

import (
	"fmt"
	"time"

	"golang.org/x/sys/windows"
)

func waitForPIDExit(pid int, timeout time.Duration) error {
	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		// If we cannot open it, assume it's already gone.
		return nil
	}
	defer windows.CloseHandle(h)

	ms := uint32(timeout / time.Millisecond)
	status, err := windows.WaitForSingleObject(h, ms)
	if err != nil {
		return err
	}
	if status == uint32(windows.WAIT_TIMEOUT) {
		return fmt.Errorf("waited %s", timeout)
	}
	return nil
}
