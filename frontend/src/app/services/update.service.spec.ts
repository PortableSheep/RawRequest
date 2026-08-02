import { TestBed } from '@angular/core/testing';
import { UpdateService } from './update.service';
import { APP_BRIDGE, type AppBridgeContract } from './app-bridge.contract';
import { EventTransportService } from './event-transport.service';

describe('UpdateService', () => {
  let service: UpdateService;
  let appBridge: vi.Mocked<Partial<AppBridgeContract>>;
  let events: vi.Mocked<Partial<EventTransportService>>;
  let originalGo: any;
  let originalRuntime: any;

  beforeEach(() => {
    localStorage.clear();

    appBridge = {
      getAppVersion: vi.fn().mockResolvedValue('1.0.0'),
      clearPreparedUpdate: vi.fn().mockResolvedValue(undefined),
      checkForUpdates: vi.fn(),
      openReleaseURL: vi.fn().mockResolvedValue(undefined),
      startUpdateAndRestart: vi.fn().mockResolvedValue(undefined),
      listReleases: vi.fn(),
    };

    events = {
      on: vi.fn().mockReturnValue(() => {}),
    };

    const g = globalThis as any;
    originalGo = g.go;
    originalRuntime = g.runtime;
    g.go = { app: { App: {} } };
    g.runtime = {};

    TestBed.configureTestingModule({
      providers: [
        UpdateService,
        { provide: APP_BRIDGE, useValue: appBridge },
        { provide: EventTransportService, useValue: events },
      ],
    });
    service = TestBed.inject(UpdateService);
  });

  afterEach(() => {
    const g = globalThis as any;
    g.go = originalGo;
    g.runtime = originalRuntime;
    localStorage.clear();
  });

  describe('init', () => {
    it('fetches the app version via the app bridge', async () => {
      await service.init();
      expect(appBridge.getAppVersion).toHaveBeenCalled();
      expect(service.appVersion()).toBe('1.0.0');
    });

    it('is a no-op without Wails bindings present', async () => {
      const g = globalThis as any;
      g.go = undefined;
      await service.init();
      expect(appBridge.getAppVersion).not.toHaveBeenCalled();
    });

    it('only initializes once', async () => {
      await service.init();
      await service.init();
      expect(appBridge.getAppVersion).toHaveBeenCalledTimes(1);
    });

    it('subscribes to updater events over the wails transport', async () => {
      await service.init();
      expect(events.on).toHaveBeenCalledWith('update:status', expect.any(Function), 'wails');
      expect(events.on).toHaveBeenCalledWith('update:progress', expect.any(Function), 'wails');
      expect(events.on).toHaveBeenCalledWith('update:ready', expect.any(Function), 'wails');
      expect(events.on).toHaveBeenCalledWith('update:error', expect.any(Function), 'wails');
    });

    it('clears a stale prepared update via the app bridge', async () => {
      localStorage.setItem('rawrequest_update_ready_version', '1.0.0');
      appBridge.getAppVersion!.mockResolvedValue('1.0.0');
      await service.init();
      expect(appBridge.clearPreparedUpdate).toHaveBeenCalled();
      expect(service.isUpdateReady()).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('delegates to the app bridge', async () => {
      const version = await service.getVersion();
      expect(appBridge.getAppVersion).toHaveBeenCalled();
      expect(version).toBe('1.0.0');
    });

    it('falls back to "unknown" on error', async () => {
      appBridge.getAppVersion!.mockRejectedValue(new Error('fail'));
      const version = await service.getVersion();
      expect(version).toBe('unknown');
    });
  });

  describe('checkForUpdates', () => {
    it('delegates to the app bridge and stores the result', async () => {
      const info = {
        available: true,
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        releaseUrl: 'https://example.com',
        releaseNotes: 'notes',
        releaseName: 'v1.1.0',
        publishedAt: '2024-01-01',
      };
      appBridge.checkForUpdates!.mockResolvedValue(info);

      const result = await service.checkForUpdates();

      expect(appBridge.checkForUpdates).toHaveBeenCalled();
      expect(result).toEqual(info);
      expect(service.updateInfo()).toEqual(info);
    });

    it('sets an error message when the bridge call fails', async () => {
      appBridge.checkForUpdates!.mockRejectedValue(new Error('network down'));
      const result = await service.checkForUpdates();
      expect(result).toBeNull();
      expect(service.error()).toBe('network down');
    });
  });

  describe('openReleasePage', () => {
    it('delegates to the app bridge with the current release URL', async () => {
      appBridge.checkForUpdates!.mockResolvedValue({
        available: true,
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        releaseUrl: 'https://example.com/release',
        releaseNotes: '',
        releaseName: '',
        publishedAt: '',
      });
      await service.checkForUpdates();

      await service.openReleasePage();

      expect(appBridge.openReleaseURL).toHaveBeenCalledWith('https://example.com/release');
    });
  });

  describe('startInstallVersion', () => {
    it('delegates to the app bridge', async () => {
      const result = await service.startInstallVersion('1.2.0');
      expect(appBridge.startUpdateAndRestart).toHaveBeenCalledWith('1.2.0');
      expect(result).toBe(true);
    });

    it('returns false for a blank version', async () => {
      const result = await service.startInstallVersion('   ');
      expect(appBridge.startUpdateAndRestart).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('surfaces an error when the bridge call fails', async () => {
      appBridge.startUpdateAndRestart!.mockRejectedValue(new Error('boom'));
      const result = await service.startInstallVersion('1.2.0');
      expect(result).toBe(false);
      expect(service.error()).toBe('boom');
    });
  });

  describe('listReleases', () => {
    it('delegates to the app bridge', async () => {
      const releases = [
        { version: '1.0.0', name: 'v1.0.0', publishedAt: '2024-01-01', releaseUrl: '', isCurrent: true },
      ];
      appBridge.listReleases!.mockResolvedValue(releases);

      const result = await service.listReleases();

      expect(appBridge.listReleases).toHaveBeenCalled();
      expect(result).toEqual(releases);
      expect(service.availableReleases()).toEqual(releases);
    });

    it('returns an empty list without Wails bindings present', async () => {
      const g = globalThis as any;
      g.go = undefined;
      const result = await service.listReleases();
      expect(appBridge.listReleases).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('clearPreparedUpdate', () => {
    it('delegates to the app bridge', () => {
      service.clearPreparedUpdate();
      expect(appBridge.clearPreparedUpdate).toHaveBeenCalled();
      expect(service.isUpdateReady()).toBe(false);
    });
  });
});
