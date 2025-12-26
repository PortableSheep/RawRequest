//go:build !darwin || !cgo

package main

import "errors"

func notifyNative(_ string, _ string) error {
	return errors.New("native notifications not supported")
}
