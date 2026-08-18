import { TestBed } from '@angular/core/testing';
import { NotificationService } from './notification.service';
import { APP_BRIDGE, type AppBridgeContract } from './app-bridge.contract';

describe('NotificationService', () => {
  let service: NotificationService;
  let appBridge: vi.Mocked<Partial<AppBridgeContract>>;
  let hasFocusSpy: any;

  beforeEach(() => {
    appBridge = {
      sendNotification: vi.fn().mockResolvedValue(undefined),
    };

    hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    TestBed.configureTestingModule({
      providers: [
        NotificationService,
        { provide: APP_BRIDGE, useValue: appBridge },
      ],
    });
    service = TestBed.inject(NotificationService);
  });

  afterEach(() => {
    hasFocusSpy.mockRestore();
  });

  function blurApp(): void {
    window.dispatchEvent(new Event('blur'));
  }

  describe('notifyIfBackground', () => {
    it('does not notify when app is focused', async () => {
      await service.notifyIfBackground('Title', 'Message');
      expect(appBridge.sendNotification).not.toHaveBeenCalled();
    });

    it('notifies via the app bridge when app is backgrounded', async () => {
      blurApp();
      await service.notifyIfBackground('Title', 'Message');
      expect(appBridge.sendNotification).toHaveBeenCalledWith('Title', 'Message');
    });

    it('skips quick requests below the duration threshold', async () => {
      blurApp();
      await service.notifyIfBackground('Title', 'Message', 500);
      expect(appBridge.sendNotification).not.toHaveBeenCalled();
    });

    it('notifies for requests at or above the duration threshold', async () => {
      blurApp();
      await service.notifyIfBackground('Title', 'Message', 2000);
      expect(appBridge.sendNotification).toHaveBeenCalledWith('Title', 'Message');
    });

    it('silently swallows bridge errors', async () => {
      blurApp();
      (appBridge.sendNotification as any).mockRejectedValue(new Error('denied'));
      await expect(service.notifyIfBackground('Title', 'Message')).resolves.toBeUndefined();
    });
  });

  describe('notifyRequestComplete', () => {
    it('formats a success notification', async () => {
      blurApp();
      await service.notifyRequestComplete('Login', 200, 2500);
      expect(appBridge.sendNotification).toHaveBeenCalledWith(
        '✓ Login Complete',
        expect.stringContaining('Status: 200'),
      );
    });

    it('formats a failure notification', async () => {
      blurApp();
      await service.notifyRequestComplete(undefined, 500, 2500);
      expect(appBridge.sendNotification).toHaveBeenCalledWith(
        '✗ Request Complete',
        expect.any(String),
      );
    });
  });

  describe('notifyLoadTestComplete', () => {
    it('formats a load test notification', async () => {
      blurApp();
      await service.notifyLoadTestComplete('Bench', 100, 5000, 42.4);
      expect(appBridge.sendNotification).toHaveBeenCalledWith(
        '⚡ Bench Complete',
        expect.stringContaining('100 requests'),
      );
    });
  });

  describe('notifyChainComplete', () => {
    it('formats a successful chain notification', async () => {
      blurApp();
      await service.notifyChainComplete(3, 4200, true);
      expect(appBridge.sendNotification).toHaveBeenCalledWith(
        '✓ Chain Complete',
        expect.stringContaining('3 requests'),
      );
    });

    it('formats a failed chain notification', async () => {
      blurApp();
      await service.notifyChainComplete(3, 4200, false);
      expect(appBridge.sendNotification).toHaveBeenCalledWith(
        '⚠ Chain Complete',
        expect.any(String),
      );
    });
  });
});
