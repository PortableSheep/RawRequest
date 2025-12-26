//go:build darwin && cgo

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation -framework UserNotifications

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

static void rr_notify(const char* title, const char* message) {
	@autoreleasepool {
		if (@available(macOS 10.14, *)) {
			UNUserNotificationCenter* center = [UNUserNotificationCenter currentNotificationCenter];
			UNMutableNotificationContent* content = [[UNMutableNotificationContent alloc] init];
			if (title) {
				content.title = [NSString stringWithUTF8String:title];
			}
			if (message) {
				content.body = [NSString stringWithUTF8String:message];
			}

			UNTimeIntervalNotificationTrigger* trigger = [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:0.1 repeats:NO];
			NSString* identifier = [[NSUUID UUID] UUIDString];
			UNNotificationRequest* request = [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:trigger];

			UNAuthorizationOptions options = (UNAuthorizationOptionAlert | UNAuthorizationOptionSound);
			[center requestAuthorizationWithOptions:options
				completionHandler:^(BOOL granted, NSError* _Nullable error) {
					if (!granted || error != nil) {
						return;
					}
					[center addNotificationRequest:request withCompletionHandler:nil];
				}];
		}
	}
}
*/
import "C"

import (
	"unsafe"
)

func notifyNative(title, message string) error {
	ct := C.CString(title)
	cm := C.CString(message)
	defer C.free(unsafe.Pointer(ct))
	defer C.free(unsafe.Pointer(cm))
	C.rr_notify(ct, cm)
	return nil
}
