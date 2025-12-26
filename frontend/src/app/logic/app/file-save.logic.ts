import type { FileTab, HistoryItem } from '../../models/http.models';
import { basename } from '../../utils/path';

export function buildFirstSaveDefaultName(file: Pick<FileTab, 'name'> & Partial<Pick<FileTab, 'displayName'>>): string {
  return file.name || file.displayName || 'untitled.http';
}

export function buildSaveAsDefaultName(
  file: Partial<Pick<FileTab, 'filePath' | 'name' | 'displayName'>>
): string {
  return basename(file.filePath || file.name || file.displayName || 'untitled.http');
}

export function buildFileAfterSave(file: FileTab, path: string): FileTab {
  return {
    ...file,
    filePath: path,
    id: path,
    name: basename(path)
  } as any;
}

export type FirstSaveHistoryMigrationDecision =
  | { shouldMigrate: false }
  | {
      shouldMigrate: true;
      oldId: string;
      newId: string;
      newHistory: HistoryItem[];
      activeHistory: HistoryItem[] | null;
    };

export function decideFirstSaveHistoryMigration(args: {
  previousId: string;
  newId: string;
  priorHistory: HistoryItem[] | null | undefined;
  activeFileId: string | null | undefined;
}): FirstSaveHistoryMigrationDecision {
  const history = args.priorHistory || [];
  if (!history.length) {
    return { shouldMigrate: false };
  }

  return {
    shouldMigrate: true,
    oldId: args.previousId,
    newId: args.newId,
    newHistory: history,
    activeHistory: args.activeFileId === args.newId ? history : null
  };
}

export type SaveAsHistoryMigrationDecision = {
  oldId: string;
  newId: string;
  newHistory: HistoryItem[];
  activeHistory: HistoryItem[] | null;
};

export function decideSaveAsHistoryMigration(args: {
  previousId: string;
  newId: string;
  priorHistory: HistoryItem[] | null | undefined;
  activeFileId: string | null | undefined;
}): SaveAsHistoryMigrationDecision {
  const history = args.priorHistory || [];
  return {
    oldId: args.previousId,
    newId: args.newId,
    newHistory: history,
    activeHistory: args.activeFileId === args.newId ? history : null
  };
}
