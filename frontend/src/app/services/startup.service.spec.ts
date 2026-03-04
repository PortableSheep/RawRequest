import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { StartupService } from './startup.service';
import { WorkspaceStateService } from './workspace-state.service';
import { SecretService } from './secret.service';
import { ToastService } from './toast.service';
import { UpdateService } from './update.service';
import { RequestExecutionService } from './request-execution.service';

const mockEnsureServiceRunning = vi.fn();
const mockGetExamplesForFirstRun = vi.fn();
const mockMarkFirstRunComplete = vi.fn();

vi.mock('@wailsjs/go/app/App', () => ({
  EnsureServiceRunning: (...args: any[]) => mockEnsureServiceRunning(...args),
  GetExamplesForFirstRun: (...args: any[]) => mockGetExamplesForFirstRun(...args),
  MarkFirstRunComplete: (...args: any[]) => mockMarkFirstRunComplete(...args),
}));

describe('StartupService', () => {
  let service: StartupService;
  let mockState: any;
  let mockSecretService: any;
  let mockToast: any;
  let mockUpdate: any;
  let mockReqExec: any;
  let destroy$: Subject<void>;

  beforeEach(() => {
    mockState = {
      loadFiles: vi.fn(),
      addFileFromContent: vi.fn(),
    };
    mockSecretService = {
      onMasterPasswordWarning: vi.fn(),
      refreshSecrets: vi.fn(),
      onMissingSecret: vi.fn().mockReturnValue(new Subject()),
    };
    mockToast = {
      info: vi.fn(),
    };
    mockUpdate = {
      init: vi.fn(),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      appVersion: vi.fn().mockReturnValue('1.0.0'),
    };
    mockReqExec = {
      subscribeToDownloadProgress: vi.fn(),
      queuedExecutionRequested: new Subject(),
    };

    TestBed.configureTestingModule({
      providers: [
        StartupService,
        { provide: WorkspaceStateService, useValue: mockState },
        { provide: SecretService, useValue: mockSecretService },
        { provide: ToastService, useValue: mockToast },
        { provide: UpdateService, useValue: mockUpdate },
        { provide: RequestExecutionService, useValue: mockReqExec },
      ],
    });
    service = TestBed.inject(StartupService);
    destroy$ = new Subject<void>();

    vi.clearAllMocks();
  });

  afterEach(() => {
    destroy$.next();
    destroy$.complete();
  });

  describe('bootstrap', () => {
    it('should initialize when backend is ready', async () => {
      mockEnsureServiceRunning.mockResolvedValue(undefined);
      mockGetExamplesForFirstRun.mockResolvedValue({ isFirstRun: false });

      await service.bootstrap(destroy$, vi.fn());

      expect(mockState.loadFiles).toHaveBeenCalled();
      expect(mockSecretService.refreshSecrets).toHaveBeenCalledWith(true);
      expect(mockUpdate.init).toHaveBeenCalled();
    });

    it('should not initialize if backend fails', async () => {
      mockEnsureServiceRunning.mockRejectedValue(new Error('connection refused'));

      await service.bootstrap(destroy$, vi.fn());

      expect(service.serviceStartupError).toContain('connection refused');
      expect(mockState.loadFiles).not.toHaveBeenCalled();
    });

    it('should only bootstrap once', async () => {
      mockEnsureServiceRunning.mockResolvedValue(undefined);
      mockGetExamplesForFirstRun.mockResolvedValue({ isFirstRun: false });

      await service.bootstrap(destroy$, vi.fn());
      await service.bootstrap(destroy$, vi.fn());

      expect(mockState.loadFiles).toHaveBeenCalledTimes(1);
    });

    it('should subscribe to download progress', async () => {
      mockEnsureServiceRunning.mockResolvedValue(undefined);
      mockGetExamplesForFirstRun.mockResolvedValue({ isFirstRun: false });

      await service.bootstrap(destroy$, vi.fn());

      expect(mockReqExec.subscribeToDownloadProgress).toHaveBeenCalledWith(destroy$);
    });

    it('should wire queued execution callback', async () => {
      mockEnsureServiceRunning.mockResolvedValue(undefined);
      mockGetExamplesForFirstRun.mockResolvedValue({ isFirstRun: false });
      const onExecute = vi.fn();

      await service.bootstrap(destroy$, onExecute);

      vi.useFakeTimers();
      mockReqExec.queuedExecutionRequested.next(3);
      vi.runAllTimers();

      expect(onExecute).toHaveBeenCalledWith(3);
      vi.useRealTimers();
    });
  });

  describe('first run', () => {
    it('should add examples file on first run', async () => {
      mockEnsureServiceRunning.mockResolvedValue(undefined);
      mockGetExamplesForFirstRun.mockResolvedValue({
        isFirstRun: true,
        content: 'GET /hello',
        filePath: '/examples.http',
      });
      mockMarkFirstRunComplete.mockResolvedValue(undefined);

      await service.bootstrap(destroy$, vi.fn());
      // checkFirstRun is fire-and-forget; flush microtasks
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockState.addFileFromContent).toHaveBeenCalledWith(
        'examples.http',
        'GET /hello',
        '/examples.http',
      );
      expect(mockMarkFirstRunComplete).toHaveBeenCalled();
    });

    it('should not add examples if not first run', async () => {
      mockEnsureServiceRunning.mockResolvedValue(undefined);
      mockGetExamplesForFirstRun.mockResolvedValue({ isFirstRun: false });

      await service.bootstrap(destroy$, vi.fn());

      expect(mockState.addFileFromContent).not.toHaveBeenCalled();
    });
  });

  describe('retryServiceStartup', () => {
    it('should clear error and re-bootstrap', async () => {
      mockEnsureServiceRunning.mockRejectedValueOnce(new Error('fail'));
      await service.bootstrap(destroy$, vi.fn());
      expect(service.serviceStartupError).not.toBeNull();

      mockEnsureServiceRunning.mockResolvedValue(undefined);
      mockGetExamplesForFirstRun.mockResolvedValue({ isFirstRun: false });

      service.retryServiceStartup(destroy$, vi.fn());

      expect(service.serviceStartupError).toBeNull();
    });
  });

  describe('master password warning', () => {
    it('should show toast when master password warning fires', async () => {
      mockEnsureServiceRunning.mockResolvedValue(undefined);
      mockGetExamplesForFirstRun.mockResolvedValue({ isFirstRun: false });

      await service.bootstrap(destroy$, vi.fn());

      const callback = mockSecretService.onMasterPasswordWarning.mock.calls[0][0];
      callback();

      expect(mockToast.info).toHaveBeenCalledWith(
        expect.stringContaining('master password'),
        5000,
      );
    });
  });
});
