import { Injectable } from '@angular/core';
import type { app as AppModels, importers as ImportersModels } from '@wailsjs/go/models';
import type { AppBridgeContract } from './app-bridge.contract';

/**
 * Default `AppBridgeContract` implementation backed by the real Wails
 * runtime. Each method dynamically imports `@wailsjs/go/app/App` so the
 * generated bindings module stays lazily loaded/code-split exactly as it
 * was before these calls were centralized here, and so the module is only
 * ever touched when running inside the desktop shell.
 */
@Injectable({
  providedIn: 'root'
})
export class WailsAppBridgeService implements AppBridgeContract {
  async watchFiles(paths: string[]): Promise<void> {
    const { WatchFiles } = await import('@wailsjs/go/app/App');
    return WatchFiles(paths);
  }

  async revealInFinder(path: string): Promise<void> {
    const { RevealInFinder } = await import('@wailsjs/go/app/App');
    return RevealInFinder(path);
  }

  async getExamplesFile(): Promise<AppModels.ExamplesForFirstRunResponse> {
    const { GetExamplesFile } = await import('@wailsjs/go/app/App');
    return GetExamplesFile();
  }

  async getMockDemoFile(): Promise<AppModels.ExamplesForFirstRunResponse> {
    const { GetMockDemoFile } = await import('@wailsjs/go/app/App');
    return GetMockDemoFile();
  }

  async openFileDialog(): Promise<string[]> {
    const { OpenFileDialog } = await import('@wailsjs/go/app/App');
    return OpenFileDialog();
  }

  async readFileContents(path: string): Promise<string> {
    const { ReadFileContents } = await import('@wailsjs/go/app/App');
    return ReadFileContents(path);
  }

  async openImportFileDialog(): Promise<string> {
    const { OpenImportFileDialog } = await import('@wailsjs/go/app/App');
    return OpenImportFileDialog();
  }

  async openImportDirectoryDialog(): Promise<string> {
    const { OpenImportDirectoryDialog } = await import('@wailsjs/go/app/App');
    return OpenImportDirectoryDialog();
  }

  async importFromPath(path: string): Promise<ImportersModels.ImportResult> {
    const { ImportFromPath } = await import('@wailsjs/go/app/App');
    return ImportFromPath(path);
  }

  async saveFileContents(path: string, content: string): Promise<string> {
    const { SaveFileContents } = await import('@wailsjs/go/app/App');
    return SaveFileContents(path, content);
  }

  async showSaveDialog(defaultName: string): Promise<string> {
    const { ShowSaveDialog } = await import('@wailsjs/go/app/App');
    return ShowSaveDialog(defaultName);
  }

  async migrateResponsesFromRunLocationToHttpFile(fileId: string, path: string): Promise<string> {
    const { MigrateResponsesFromRunLocationToHttpFile } = await import('@wailsjs/go/app/App');
    return MigrateResponsesFromRunLocationToHttpFile(fileId, path);
  }

  async ensureServiceRunning(baseUrl: string): Promise<void> {
    const { EnsureServiceRunning } = await import('@wailsjs/go/app/App');
    return EnsureServiceRunning(baseUrl);
  }

  async getExamplesForFirstRun(): Promise<AppModels.ExamplesForFirstRunResponse> {
    const { GetExamplesForFirstRun } = await import('@wailsjs/go/app/App');
    return GetExamplesForFirstRun();
  }

  async markFirstRunComplete(): Promise<void> {
    const { MarkFirstRunComplete } = await import('@wailsjs/go/app/App');
    return MarkFirstRunComplete();
  }

  async sendNotification(title: string, message: string): Promise<void> {
    const { SendNotification } = await import('@wailsjs/go/app/App');
    return SendNotification(title, message);
  }

  async checkForUpdates(): Promise<AppModels.UpdateInfo> {
    const { CheckForUpdates } = await import('@wailsjs/go/app/App');
    return CheckForUpdates();
  }

  async clearPreparedUpdate(): Promise<void> {
    const { ClearPreparedUpdate } = await import('@wailsjs/go/app/App');
    return ClearPreparedUpdate();
  }

  async getAppVersion(): Promise<string> {
    const { GetAppVersion } = await import('@wailsjs/go/app/App');
    return GetAppVersion();
  }

  async listReleases(): Promise<AppModels.ReleaseInfo[]> {
    const { ListReleases } = await import('@wailsjs/go/app/App');
    return ListReleases();
  }

  async openReleaseURL(url: string): Promise<void> {
    const { OpenReleaseURL } = await import('@wailsjs/go/app/App');
    return OpenReleaseURL(url);
  }

  async startUpdateAndRestart(version: string): Promise<void> {
    const { StartUpdateAndRestart } = await import('@wailsjs/go/app/App');
    return StartUpdateAndRestart(version);
  }

  async startMockServer(content: string, filePath: string, port: number, dbPath: string): Promise<void> {
    const { StartMockServer } = await import('@wailsjs/go/app/App');
    return StartMockServer(content, filePath, port, dbPath);
  }

  async stopMockServer(): Promise<void> {
    const { StopMockServer } = await import('@wailsjs/go/app/App');
    return StopMockServer();
  }

  async getMockServerStatus(): Promise<AppModels.MockServerStatus> {
    const { GetMockServerStatus } = await import('@wailsjs/go/app/App');
    return GetMockServerStatus();
  }

  async saveBase64ToFile(base64Data: string, contentType: string, requestUrl: string): Promise<string> {
    const { SaveBase64ToFile } = await import('@wailsjs/go/app/App');
    return SaveBase64ToFile(base64Data, contentType, requestUrl);
  }
}
