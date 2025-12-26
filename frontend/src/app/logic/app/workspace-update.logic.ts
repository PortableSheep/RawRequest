import type { FileTab } from '../../models/http.models';

export type WorkspaceStateUpdateLike = {
  files: FileTab[];
  currentFileIndex: number;
  activeFileId?: string;
  currentEnv?: string;
};

export type DerivedAppStateFromWorkspaceUpdate = {
  files: FileTab[];
  currentFileIndex: number;
  activeFileId: string | null;
  currentEnv: string;
};

export type SyncCurrentEnvWithFileFn = (files: FileTab[], index: number) => {
  files: FileTab[];
  currentFileIndex: number;
  activeFileId?: string;
  currentEnv?: string;
};

export function deriveAppStateFromWorkspaceUpdate(
  update: WorkspaceStateUpdateLike
): DerivedAppStateFromWorkspaceUpdate {
  const files = update.files;
  const currentFileIndex = update.currentFileIndex;

  const activeFileId = update.activeFileId ?? files[currentFileIndex]?.id ?? null;

  const currentEnv =
    update.currentEnv !== undefined
      ? update.currentEnv
      : (files[currentFileIndex]?.selectedEnv || '');

  return { files, currentFileIndex, activeFileId, currentEnv };
}

export function deriveAppStateAfterWorkspaceUpdateWithEnvSync(args: {
  update: WorkspaceStateUpdateLike;
  syncCurrentEnvWithFile: SyncCurrentEnvWithFileFn;
}): DerivedAppStateFromWorkspaceUpdate {
  const base = deriveAppStateFromWorkspaceUpdate(args.update);
  const synced = args.syncCurrentEnvWithFile(base.files, base.currentFileIndex);
  return deriveAppStateFromWorkspaceUpdate({
    files: synced.files,
    currentFileIndex: synced.currentFileIndex,
    activeFileId: synced.activeFileId,
    currentEnv: synced.currentEnv
  });
}
