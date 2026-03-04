import '@angular/compiler';
import '@analogjs/vitest-angular/setup-zone';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';
import '@testing-library/jest-dom/vitest';

setupTestBed({ zoneless: false });

// Minimal Wails runtime stubs so unit tests can import services that depend on
// generated bindings without requiring the real desktop runtime.
declare global {
	interface Window {
		go?: any;
		runtime?: any;
	}
}

const w = window as any;
w.go ??= {};
w.go.app ??= {};

// Create a lazily-resolving mock for any backend method.
if (!w.go.app.App) {
	w.go.app.App = new Proxy(
		{},
		{
			get(_target, prop) {
				if (typeof prop === 'string') {
					if (prop === 'CheckForUpdates') {
						return vi.fn(async () => ({
							available: false,
							currentVersion: 'test',
							latestVersion: 'test',
							releaseUrl: '',
							releaseNotes: '',
							releaseName: '',
							publishedAt: ''
						}));
					}
					return vi.fn(async () => undefined);
				}
				return undefined;
			}
		}
	);
}

w.runtime ??= new Proxy(
	{},
	{
		get() {
			return vi.fn(async () => undefined);
		}
	}
);
