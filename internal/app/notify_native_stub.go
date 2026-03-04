//go:build !darwin || !cgo

package app

import "errors"

func notifyNative(_ string, _ string) error {
	return errors.New("native notifications not supported")
}
