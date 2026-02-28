//go:build windows

package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// refreshCLICopyBestEffort updates the CLI copy at %LOCALAPPDATA%\RawRequest\rawrequest.exe
// if it exists. This keeps the PATH-accessible copy in sync after an update.
func refreshCLICopyBestEffort(installPath string) {
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return
	}
	cliDir := filepath.Join(localAppData, "RawRequest")
	serviceCmd := filepath.Join(cliDir, "rawrequest-service.cmd")
	cliExe := filepath.Join(cliDir, "rawrequest.exe")
	if _, err := os.Stat(cliExe); err != nil {
		return // CLI was never set up; nothing to refresh
	}

	newExe := filepath.Join(installPath, "RawRequest.exe")
	if _, err := os.Stat(newExe); err != nil {
		return
	}

	fmt.Printf("Refreshing CLI copy at %s...\n", cliExe)
	if err := overwriteFile(newExe, cliExe); err != nil {
		fmt.Printf("Warning: failed to refresh CLI copy: %v\n", err)
		return
	}
	if err := writeFileIfChanged(serviceCmd, windowsServiceLauncherScript(), 0o644); err != nil {
		fmt.Printf("Warning: failed to refresh service launcher: %v\n", err)
	}
	fmt.Printf("CLI copy refreshed.\n")
}

func overwriteFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}
