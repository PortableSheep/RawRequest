import { InjectionToken, inject } from '@angular/core';
import type { app as AppModels, importers as ImportersModels } from '@wailsjs/go/models';
import { WailsAppBridgeService } from './wails-app-bridge.service';

/**
 * Abstraction over the Wails-generated `@wailsjs/go/app/App` bindings.
 *
 * Consumers should inject `APP_BRIDGE` instead of dynamically importing
 * `@wailsjs/go/app/App` directly. This keeps desktop-only APIs (native
 * dialogs, filesystem access, first-run bootstrapping, ...) behind a single
 * seam that tests can fake without `vi.mock('@wailsjs/...')`, mirroring the
 * `BACKEND_CLIENT` contract used for request-execution/secrets calls.
 */
export interface AppBridgeContract {
  // Workspace / file watching
  watchFiles(paths: string[]): Promise<void>;
  revealInFinder(path: string): Promise<void>;
  getExamplesFile(): Promise<AppModels.ExamplesForFirstRunResponse>;
  getMockDemoFile(): Promise<AppModels.ExamplesForFirstRunResponse>;

  // Native file dialogs / import
  openFileDialog(): Promise<string[]>;
  readFileContents(path: string): Promise<string>;
  openImportFileDialog(): Promise<string>;
  openImportDirectoryDialog(): Promise<string>;
  importFromPath(path: string): Promise<ImportersModels.ImportResult>;

  // Save / migrate
  saveFileContents(path: string, content: string): Promise<string>;
  showSaveDialog(defaultName: string): Promise<string>;
  migrateResponsesFromRunLocationToHttpFile(fileId: string, path: string): Promise<string>;

  // Startup / first run
  ensureServiceRunning(baseUrl: string): Promise<void>;
  getExamplesForFirstRun(): Promise<AppModels.ExamplesForFirstRunResponse>;
  markFirstRunComplete(): Promise<void>;

  // Notifications
  sendNotification(title: string, message: string): Promise<void>;

  // App updates
  checkForUpdates(): Promise<AppModels.UpdateInfo>;
  clearPreparedUpdate(): Promise<void>;
  getAppVersion(): Promise<string>;
  listReleases(): Promise<AppModels.ReleaseInfo[]>;
  openReleaseURL(url: string): Promise<void>;
  startUpdateAndRestart(version: string): Promise<void>;

  // Mock server
  startMockServer(content: string, filePath: string, port: number, dbPath: string): Promise<void>;
  stopMockServer(): Promise<void>;
  getMockServerStatus(): Promise<AppModels.MockServerStatus>;

  // Binary response export
  saveBase64ToFile(base64Data: string, contentType: string, requestUrl: string): Promise<string>;
}

export const APP_BRIDGE = new InjectionToken<AppBridgeContract>('APP_BRIDGE', {
  providedIn: 'root',
  factory: () => inject(WailsAppBridgeService),
});
