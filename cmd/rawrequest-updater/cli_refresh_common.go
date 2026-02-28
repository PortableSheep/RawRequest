package main

import (
	"bytes"
	"os"
)

func windowsServiceLauncherScript() []byte {
	return []byte("@echo off\r\n\"%~dp0rawrequest.exe\" service %*\r\n")
}

func writeFileIfChanged(path string, content []byte, perm os.FileMode) error {
	current, err := os.ReadFile(path)
	if err == nil && bytes.Equal(current, content) {
		return nil
	}
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.WriteFile(path, content, perm)
}
