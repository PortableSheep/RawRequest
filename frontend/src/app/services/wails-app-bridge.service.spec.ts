import { TestBed } from '@angular/core/testing';
import { WailsAppBridgeService } from './wails-app-bridge.service';

// This is the one place a `@wailsjs/go/app/App` mock belongs: `WailsAppBridgeService`
// is the seam that owns the dynamic import. Every consumer of `APP_BRIDGE`
// injects a fake `AppBridgeContract` instead of mocking the generated module directly.
const mockWatchFiles = vi.fn();
const mockRevealInFinder = vi.fn();
const mockGetExamplesFile = vi.fn();
const mockGetMockDemoFile = vi.fn();
const mockOpenFileDialog = vi.fn();
const mockReadFileContents = vi.fn();
const mockOpenImportFileDialog = vi.fn();
const mockOpenImportDirectoryDialog = vi.fn();
const mockImportFromPath = vi.fn();
const mockSaveFileContents = vi.fn();
const mockShowSaveDialog = vi.fn();
const mockMigrateResponsesFromRunLocationToHttpFile = vi.fn();
const mockEnsureServiceRunning = vi.fn();
const mockGetExamplesForFirstRun = vi.fn();
const mockMarkFirstRunComplete = vi.fn();
const mockSendNotification = vi.fn();
const mockCheckForUpdates = vi.fn();
const mockClearPreparedUpdate = vi.fn();
const mockGetAppVersion = vi.fn();
const mockListReleases = vi.fn();
const mockOpenReleaseURL = vi.fn();
const mockStartUpdateAndRestart = vi.fn();
const mockStartMockServer = vi.fn();
const mockStopMockServer = vi.fn();
const mockGetMockServerStatus = vi.fn();

vi.mock('@wailsjs/go/app/App', () => ({
  WatchFiles: (...args: any[]) => mockWatchFiles(...args),
  RevealInFinder: (...args: any[]) => mockRevealInFinder(...args),
  GetExamplesFile: (...args: any[]) => mockGetExamplesFile(...args),
  GetMockDemoFile: (...args: any[]) => mockGetMockDemoFile(...args),
  OpenFileDialog: (...args: any[]) => mockOpenFileDialog(...args),
  ReadFileContents: (...args: any[]) => mockReadFileContents(...args),
  OpenImportFileDialog: (...args: any[]) => mockOpenImportFileDialog(...args),
  OpenImportDirectoryDialog: (...args: any[]) => mockOpenImportDirectoryDialog(...args),
  ImportFromPath: (...args: any[]) => mockImportFromPath(...args),
  SaveFileContents: (...args: any[]) => mockSaveFileContents(...args),
  ShowSaveDialog: (...args: any[]) => mockShowSaveDialog(...args),
  MigrateResponsesFromRunLocationToHttpFile: (...args: any[]) =>
    mockMigrateResponsesFromRunLocationToHttpFile(...args),
  EnsureServiceRunning: (...args: any[]) => mockEnsureServiceRunning(...args),
  GetExamplesForFirstRun: (...args: any[]) => mockGetExamplesForFirstRun(...args),
  MarkFirstRunComplete: (...args: any[]) => mockMarkFirstRunComplete(...args),
  SendNotification: (...args: any[]) => mockSendNotification(...args),
  CheckForUpdates: (...args: any[]) => mockCheckForUpdates(...args),
  ClearPreparedUpdate: (...args: any[]) => mockClearPreparedUpdate(...args),
  GetAppVersion: (...args: any[]) => mockGetAppVersion(...args),
  ListReleases: (...args: any[]) => mockListReleases(...args),
  OpenReleaseURL: (...args: any[]) => mockOpenReleaseURL(...args),
  StartUpdateAndRestart: (...args: any[]) => mockStartUpdateAndRestart(...args),
  StartMockServer: (...args: any[]) => mockStartMockServer(...args),
  StopMockServer: (...args: any[]) => mockStopMockServer(...args),
  GetMockServerStatus: (...args: any[]) => mockGetMockServerStatus(...args),
}));

describe('WailsAppBridgeService', () => {
  let service: WailsAppBridgeService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [WailsAppBridgeService] });
    service = TestBed.inject(WailsAppBridgeService);
    vi.clearAllMocks();
  });

  it('delegates watchFiles to WatchFiles', async () => {
    mockWatchFiles.mockResolvedValue(undefined);
    await service.watchFiles(['/a.http']);
    expect(mockWatchFiles).toHaveBeenCalledWith(['/a.http']);
  });

  it('delegates revealInFinder to RevealInFinder', async () => {
    mockRevealInFinder.mockResolvedValue(undefined);
    await service.revealInFinder('/a.http');
    expect(mockRevealInFinder).toHaveBeenCalledWith('/a.http');
  });

  it('delegates getExamplesFile to GetExamplesFile', async () => {
    mockGetExamplesFile.mockResolvedValue({ content: 'x', filePath: 'e.http', isFirstRun: false });
    const result = await service.getExamplesFile();
    expect(mockGetExamplesFile).toHaveBeenCalled();
    expect(result.content).toBe('x');
  });

  it('delegates getMockDemoFile to GetMockDemoFile', async () => {
    mockGetMockDemoFile.mockResolvedValue({ content: 'y', filePath: 'm.http', isFirstRun: false });
    const result = await service.getMockDemoFile();
    expect(mockGetMockDemoFile).toHaveBeenCalled();
    expect(result.content).toBe('y');
  });

  it('delegates openFileDialog to OpenFileDialog', async () => {
    mockOpenFileDialog.mockResolvedValue(['/a.http']);
    const result = await service.openFileDialog();
    expect(result).toEqual(['/a.http']);
  });

  it('delegates readFileContents to ReadFileContents', async () => {
    mockReadFileContents.mockResolvedValue('GET /a');
    const result = await service.readFileContents('/a.http');
    expect(mockReadFileContents).toHaveBeenCalledWith('/a.http');
    expect(result).toBe('GET /a');
  });

  it('delegates openImportFileDialog to OpenImportFileDialog', async () => {
    mockOpenImportFileDialog.mockResolvedValue('/collection.json');
    const result = await service.openImportFileDialog();
    expect(result).toBe('/collection.json');
  });

  it('delegates openImportDirectoryDialog to OpenImportDirectoryDialog', async () => {
    mockOpenImportDirectoryDialog.mockResolvedValue('/collection-dir');
    const result = await service.openImportDirectoryDialog();
    expect(result).toBe('/collection-dir');
  });

  it('delegates importFromPath to ImportFromPath', async () => {
    mockImportFromPath.mockResolvedValue({ Files: [] });
    const result = await service.importFromPath('/collection.json');
    expect(mockImportFromPath).toHaveBeenCalledWith('/collection.json');
    expect(result.Files).toEqual([]);
  });

  it('delegates saveFileContents to SaveFileContents', async () => {
    mockSaveFileContents.mockResolvedValue('ok');
    const result = await service.saveFileContents('/a.http', 'GET /a');
    expect(mockSaveFileContents).toHaveBeenCalledWith('/a.http', 'GET /a');
    expect(result).toBe('ok');
  });

  it('delegates showSaveDialog to ShowSaveDialog', async () => {
    mockShowSaveDialog.mockResolvedValue('/new.http');
    const result = await service.showSaveDialog('new.http');
    expect(mockShowSaveDialog).toHaveBeenCalledWith('new.http');
    expect(result).toBe('/new.http');
  });

  it('delegates migrateResponsesFromRunLocationToHttpFile to MigrateResponsesFromRunLocationToHttpFile', async () => {
    mockMigrateResponsesFromRunLocationToHttpFile.mockResolvedValue('done');
    const result = await service.migrateResponsesFromRunLocationToHttpFile('id1', '/a.http');
    expect(mockMigrateResponsesFromRunLocationToHttpFile).toHaveBeenCalledWith('id1', '/a.http');
    expect(result).toBe('done');
  });

  it('delegates ensureServiceRunning to EnsureServiceRunning', async () => {
    mockEnsureServiceRunning.mockResolvedValue(undefined);
    await service.ensureServiceRunning('http://localhost:1234');
    expect(mockEnsureServiceRunning).toHaveBeenCalledWith('http://localhost:1234');
  });

  it('delegates getExamplesForFirstRun to GetExamplesForFirstRun', async () => {
    mockGetExamplesForFirstRun.mockResolvedValue({ content: '', filePath: '', isFirstRun: true });
    const result = await service.getExamplesForFirstRun();
    expect(result.isFirstRun).toBe(true);
  });

  it('delegates markFirstRunComplete to MarkFirstRunComplete', async () => {
    mockMarkFirstRunComplete.mockResolvedValue(undefined);
    await service.markFirstRunComplete();
    expect(mockMarkFirstRunComplete).toHaveBeenCalled();
  });

  it('delegates sendNotification to SendNotification', async () => {
    mockSendNotification.mockResolvedValue(undefined);
    await service.sendNotification('Title', 'Message');
    expect(mockSendNotification).toHaveBeenCalledWith('Title', 'Message');
  });

  it('delegates checkForUpdates to CheckForUpdates', async () => {
    mockCheckForUpdates.mockResolvedValue({ available: true } as any);
    const result = await service.checkForUpdates();
    expect(mockCheckForUpdates).toHaveBeenCalled();
    expect(result.available).toBe(true);
  });

  it('delegates clearPreparedUpdate to ClearPreparedUpdate', async () => {
    mockClearPreparedUpdate.mockResolvedValue(undefined);
    await service.clearPreparedUpdate();
    expect(mockClearPreparedUpdate).toHaveBeenCalled();
  });

  it('delegates getAppVersion to GetAppVersion', async () => {
    mockGetAppVersion.mockResolvedValue('1.2.3');
    const result = await service.getAppVersion();
    expect(result).toBe('1.2.3');
  });

  it('delegates listReleases to ListReleases', async () => {
    mockListReleases.mockResolvedValue([{ version: '1.0.0' }] as any);
    const result = await service.listReleases();
    expect(mockListReleases).toHaveBeenCalled();
    expect(result).toEqual([{ version: '1.0.0' }]);
  });

  it('delegates openReleaseURL to OpenReleaseURL', async () => {
    mockOpenReleaseURL.mockResolvedValue(undefined);
    await service.openReleaseURL('https://example.com/release');
    expect(mockOpenReleaseURL).toHaveBeenCalledWith('https://example.com/release');
  });

  it('delegates startUpdateAndRestart to StartUpdateAndRestart', async () => {
    mockStartUpdateAndRestart.mockResolvedValue(undefined);
    await service.startUpdateAndRestart('2.0.0');
    expect(mockStartUpdateAndRestart).toHaveBeenCalledWith('2.0.0');
  });

  it('delegates startMockServer to StartMockServer', async () => {
    mockStartMockServer.mockResolvedValue(undefined);
    await service.startMockServer('GET /a', '/a.http', 8080, '/tmp/mock.db');
    expect(mockStartMockServer).toHaveBeenCalledWith('GET /a', '/a.http', 8080, '/tmp/mock.db');
  });

  it('delegates stopMockServer to StopMockServer', async () => {
    mockStopMockServer.mockResolvedValue(undefined);
    await service.stopMockServer();
    expect(mockStopMockServer).toHaveBeenCalled();
  });

  it('delegates getMockServerStatus to GetMockServerStatus', async () => {
    mockGetMockServerStatus.mockResolvedValue({ running: true, port: 8080, dbPath: '/tmp/mock.db' } as any);
    const result = await service.getMockServerStatus();
    expect(mockGetMockServerStatus).toHaveBeenCalled();
    expect(result.running).toBe(true);
  });
});
