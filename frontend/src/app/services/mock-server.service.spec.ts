import { TestBed } from '@angular/core/testing';
import { MockServerService } from './mock-server.service';
import { APP_BRIDGE, type AppBridgeContract } from './app-bridge.contract';
import { EventTransportService } from './event-transport.service';

describe('MockServerService', () => {
  let appBridge: vi.Mocked<Partial<AppBridgeContract>>;
  let events: vi.Mocked<Partial<EventTransportService>>;
  let eventCallback: ((log: any) => void) | undefined;

  function createService(): MockServerService {
    return TestBed.inject(MockServerService);
  }

  beforeEach(() => {
    eventCallback = undefined;

    appBridge = {
      getMockServerStatus: vi.fn().mockResolvedValue({ running: false, port: 8080, dbPath: '' }),
      startMockServer: vi.fn().mockResolvedValue(undefined),
      stopMockServer: vi.fn().mockResolvedValue(undefined),
    };

    events = {
      on: vi.fn().mockImplementation((_event: string, callback: (log: any) => void) => {
        eventCallback = callback;
        return () => {};
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        MockServerService,
        { provide: APP_BRIDGE, useValue: appBridge },
        { provide: EventTransportService, useValue: events },
      ],
    });
  });

  it('subscribes to mock-server-log events via the event transport on construction', () => {
    createService();
    expect(events.on).toHaveBeenCalledWith('mock-server-log', expect.any(Function));
  });

  it('appends incoming log events to the log signal', async () => {
    const service = createService();
    await Promise.resolve();

    eventCallback?.({ timestamp: '12:00:00', level: 'info', source: 'mockserver', message: 'hello' });

    expect(service.logs()).toEqual([
      { timestamp: '12:00:00', level: 'info', source: 'mockserver', message: 'hello' },
    ]);
  });

  describe('syncStatus', () => {
    it('syncs status from the app bridge', async () => {
      appBridge.getMockServerStatus!.mockResolvedValue({ running: true, port: 9090, dbPath: '/tmp/db' });
      const service = createService();

      await service.syncStatus();

      expect(service.status()).toEqual({ running: true, port: 9090, dbPath: '/tmp/db' });
    });

    it('defaults port and dbPath when missing from the response', async () => {
      appBridge.getMockServerStatus!.mockResolvedValue({ running: true, port: 0, dbPath: '' });
      const service = createService();

      await service.syncStatus();

      expect(service.status()).toEqual({ running: true, port: 8080, dbPath: '' });
    });

    it('swallows errors from the app bridge', async () => {
      appBridge.getMockServerStatus!.mockRejectedValue(new Error('boom'));
      const service = createService();

      await expect(service.syncStatus()).resolves.toBeUndefined();
    });
  });

  describe('start', () => {
    it('starts the mock server via the app bridge and updates state', async () => {
      const service = createService();

      await service.start('GET /a', '/a.http', 9090, '/tmp/db');

      expect(appBridge.startMockServer).toHaveBeenCalledWith('GET /a', '/a.http', 9090, '/tmp/db');
      expect(service.status()).toEqual({ running: true, port: 9090, dbPath: '/tmp/db' });
      expect(service.logs()).toEqual([
        expect.objectContaining({ level: 'info', message: expect.stringContaining('Started on') }),
      ]);
    });

    it('logs and rethrows on failure', async () => {
      appBridge.startMockServer!.mockRejectedValue(new Error('port in use'));
      const service = createService();

      await expect(service.start('GET /a', '/a.http', 9090, '/tmp/db')).rejects.toThrow('port in use');
      expect(service.logs()).toEqual([
        expect.objectContaining({ level: 'error', message: expect.stringContaining('port in use') }),
      ]);
    });
  });

  describe('stop', () => {
    it('stops the mock server via the app bridge and updates state', async () => {
      const service = createService();
      await service.start('GET /a', '/a.http', 9090, '/tmp/db');

      await service.stop();

      expect(appBridge.stopMockServer).toHaveBeenCalled();
      expect(service.status()).toEqual({ running: false, port: 9090, dbPath: '/tmp/db' });
    });

    it('rethrows on failure', async () => {
      appBridge.stopMockServer!.mockRejectedValue(new Error('cannot stop'));
      const service = createService();

      await expect(service.stop()).rejects.toThrow('cannot stop');
    });
  });

  describe('clearLogs', () => {
    it('clears the logs signal', async () => {
      const service = createService();
      await service.start('GET /a', '/a.http', 9090, '/tmp/db');

      service.clearLogs();

      expect(service.logs()).toEqual([]);
    });
  });

  describe('destroy', () => {
    it('unsubscribes from log events', () => {
      const unsubscribe = vi.fn();
      events.on = vi.fn().mockReturnValue(unsubscribe);
      TestBed.overrideProvider(EventTransportService, { useValue: events });
      const service = createService();

      service.destroy();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });
});
