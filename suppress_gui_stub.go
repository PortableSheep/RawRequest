//go:build (!darwin || !cgo) && !windows

package main

func suppressGUI() {}
