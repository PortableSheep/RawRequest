//go:build windows

package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// refreshCLICopyBestEffort keeps CLI aliases in sync after an auto-update.
//
// Two install layouts exist:
//  1. NSIS installer – installs to e.g. C:\Program Files\RawRequest with a
//     rawrequest.exe alias (copy of RawRequest.exe) and rawrequest-service.cmd
//     in the same directory. PATH points at the install dir.
//  2. Portable / install.ps1 – copies rawrequest.exe + rawrequest-service.cmd
//     to %LOCALAPPDATA%\RawRequest and adds that to the user PATH.
//
// The auto-updater swaps the entire install directory with the contents of
// the portable ZIP which only ships RawRequest.exe (uppercase). We recreate
// the lowercase alias and service launcher in both locations.
func refreshCLICopyBestEffort(installPath string) {
	newExe := filepath.Join(installPath, "RawRequest.exe")
	if _, err := os.Stat(newExe); err != nil {
		return
	}

	// 1. In-place alias (NSIS layout): create rawrequest.exe next to
	//    RawRequest.exe so the PATH entry added by the installer keeps working.
	inPlaceCLI := filepath.Join(installPath, "rawrequest.exe")
	if _, err := os.Stat(inPlaceCLI); err != nil {
		// Missing after directory swap — recreate.
		fmt.Printf("Creating CLI alias at %s...\n", inPlaceCLI)
		if err := overwriteFile(newExe, inPlaceCLI); err != nil {
			fmt.Printf("Warning: failed to create in-place CLI alias: %v\n", err)
		}
	}
	inPlaceService := filepath.Join(installPath, "rawrequest-service.cmd")
	if err := writeFileIfChanged(inPlaceService, windowsServiceLauncherScript(), 0o644); err != nil {
		fmt.Printf("Warning: failed to refresh in-place service launcher: %v\n", err)
	}

	// 2. Portable / install.ps1 copy at %LOCALAPPDATA%\RawRequest.
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return
	}
	cliDir := filepath.Join(localAppData, "RawRequest")
	cliExe := filepath.Join(cliDir, "rawrequest.exe")
	if _, err := os.Stat(cliExe); err != nil {
		return // CLI was never set up via install.ps1; nothing to refresh
	}

	fmt.Printf("Refreshing CLI copy at %s...\n", cliExe)
	if err := overwriteFile(newExe, cliExe); err != nil {
		fmt.Printf("Warning: failed to refresh CLI copy: %v\n", err)
		return
	}
	serviceCmd := filepath.Join(cliDir, "rawrequest-service.cmd")
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
