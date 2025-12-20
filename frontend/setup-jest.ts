import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';
import '@testing-library/jest-dom';

setupZoneTestEnv();

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
w.go.main ??= {};

// Create a lazily-resolving mock for any backend method.
if (!w.go.main.App) {
	w.go.main.App = new Proxy(
		{},
		{
			get(_target, prop) {
				if (typeof prop === 'string') {
					if (prop === 'CheckForUpdates') {
						return jest.fn(async () => ({
							available: false,
							currentVersion: 'test',
							latestVersion: 'test',
							releaseUrl: '',
							releaseNotes: '',
							releaseName: '',
							publishedAt: ''
						}));
					}
					return jest.fn(async () => undefined);
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
			return jest.fn(async () => undefined);
		}
	}
);
