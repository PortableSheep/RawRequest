import { Injectable, inject } from '@angular/core';
import { WorkspaceStateService } from './workspace-state.service';
import { HttpService } from './http.service';
import { HistoryStoreService } from './history-store.service';
import { WorkspaceFacadeService } from './workspace-facade.service';
import {
  buildFileAfterSave,
  buildFirstSaveDefaultName,
  buildSaveAsDefaultName,
  decideFirstSaveHistoryMigration,
  decideSaveAsHistoryMigration,
} from '../logic/app/file-save.logic';

@Injectable({ providedIn: 'root' })
export class FileSaveService {
  private readonly state = inject(WorkspaceStateService);
  private readonly httpService = inject(HttpService);
  private readonly historyStore = inject(HistoryStoreService);
  private readonly workspace = inject(WorkspaceFacadeService);

  async saveCurrentFile(): Promise<void> {
    const file = this.state.getCurrentFile();
    if (!file) return;

    try {
      const {
        SaveFileContents,
        ShowSaveDialog,
        MigrateResponsesFromRunLocationToHttpFile,
      } = await import('@wailsjs/go/main/App');

      if (file.filePath && file.filePath.length) {
        await SaveFileContents(file.filePath, file.content);
      } else {
        const previousId = file.id;
        const defaultName = buildFirstSaveDefaultName(file);
        const path = await ShowSaveDialog(defaultName);
        if (path && path.length) {
          await SaveFileContents(path, file.content);

          let priorHistory: any[] = [];
          try {
            priorHistory = await this.httpService.loadHistory(previousId);
          } catch (historyErr) {
            console.warn('Failed to load prior history on first save:', historyErr);
          }

          try {
            await MigrateResponsesFromRunLocationToHttpFile(previousId, path);
          } catch (moveErr) {
            console.warn('Failed to migrate response files on first save:', moveErr);
          }

          const updated = buildFileAfterSave(file, path);
          const idx = this.state.currentFileIndex();
          this.state.replaceFileAtIndex(idx, updated);
          this.httpService.saveFiles(this.state.files());

          try {
            const decision = decideFirstSaveHistoryMigration({
              previousId,
              newId: updated.id,
              priorHistory,
              activeFileId: this.state.files()[this.state.currentFileIndex()]?.id,
            });

            if (decision.shouldMigrate) {
              this.historyStore.delete(decision.oldId);
              this.historyStore.set(decision.newId, decision.newHistory);
              if (decision.activeHistory) {
                this.state.history.set(decision.activeHistory);
              }
            }
          } catch (historyErr) {
            console.warn('Failed to migrate history on first save:', historyErr);
          }
        }
      }
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }

  async saveCurrentFileAs(): Promise<void> {
    const file = this.state.getCurrentFile();
    if (!file) return;

    try {
      const {
        SaveFileContents,
        ShowSaveDialog,
        MigrateResponsesFromRunLocationToHttpFile,
      } = await import('@wailsjs/go/main/App');

      const previousId = file.id;
      const previousPath = file.filePath;
      const defaultName = buildSaveAsDefaultName(file);
      const path = await ShowSaveDialog(defaultName);
      if (!path || !path.length) {
        return;
      }

      await SaveFileContents(path, file.content);
      const updated = buildFileAfterSave(file, path);

      const idx = this.state.currentFileIndex();
      this.state.replaceFileAtIndex(idx, updated);
      this.httpService.saveFiles(this.state.files());

      try {
        const priorHistory = await this.httpService.loadHistory(previousId, previousPath);

        if (!previousPath || !previousPath.length) {
          try {
            await MigrateResponsesFromRunLocationToHttpFile(previousId, path);
          } catch (moveErr) {
            console.warn('Failed to migrate response files on Save As:', moveErr);
          }
        }

        const decision = decideSaveAsHistoryMigration({
          previousId,
          newId: updated.id,
          priorHistory,
          activeFileId: this.state.files()[this.state.currentFileIndex()]?.id,
        });
        this.historyStore.delete(decision.oldId);
        this.historyStore.set(decision.newId, decision.newHistory);
        if (decision.activeHistory) {
          this.state.history.set(decision.activeHistory);
        }
      } catch (historyErr) {
        console.warn('Failed to migrate history on Save As:', historyErr);
      }
    } catch (err) {
      console.error('Failed to save file as:', err);
    }
  }
}
