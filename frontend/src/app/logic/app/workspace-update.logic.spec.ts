import type { FileTab } from '../../models/http.models';
import { deriveAppStateAfterWorkspaceUpdateWithEnvSync, deriveAppStateFromWorkspaceUpdate } from './workspace-update.logic';

describe('workspace-update.logic', () => {
  it('prefers explicit currentEnv even if empty string', () => {
    const files = [{ id: 'a', selectedEnv: 'prod' } as any as FileTab];
    expect(
      deriveAppStateFromWorkspaceUpdate({ files, currentFileIndex: 0, currentEnv: '' })
    ).toEqual({
      files,
      currentFileIndex: 0,
      activeFileId: 'a',
      currentEnv: ''
    });
  });

  it('falls back to selectedEnv when currentEnv is undefined', () => {
    const files = [{ id: 'a', selectedEnv: 'prod' } as any as FileTab];
    expect(deriveAppStateFromWorkspaceUpdate({ files, currentFileIndex: 0 })).toEqual({
      files,
      currentFileIndex: 0,
      activeFileId: 'a',
      currentEnv: 'prod'
    });
  });

  it('prefers activeFileId override when provided', () => {
    const files = [{ id: 'a', selectedEnv: '' } as any as FileTab];
    expect(deriveAppStateFromWorkspaceUpdate({ files, currentFileIndex: 0, activeFileId: 'x' })).toEqual({
      files,
      currentFileIndex: 0,
      activeFileId: 'x',
      currentEnv: ''
    });
  });

  it('returns null activeFileId when index is out of range', () => {
    const files: FileTab[] = [];
    expect(deriveAppStateFromWorkspaceUpdate({ files, currentFileIndex: 0 })).toEqual({
      files,
      currentFileIndex: 0,
      activeFileId: null,
      currentEnv: ''
    });
  });

  it('deriveAppStateAfterWorkspaceUpdateWithEnvSync uses synced files/env', () => {
    const baseFiles = [{ id: 'a', selectedEnv: 'dev' } as any as FileTab];
    const syncedFiles = [{ id: 'b', selectedEnv: 'prod' } as any as FileTab];

    const result = deriveAppStateAfterWorkspaceUpdateWithEnvSync({
      update: { files: baseFiles, currentFileIndex: 0 },
      syncCurrentEnvWithFile: (files, index) => {
        expect(files).toBe(baseFiles);
        expect(index).toBe(0);
        return {
          files: syncedFiles,
          currentFileIndex: 0,
          activeFileId: 'b',
          currentEnv: 'prod'
        };
      }
    });

    expect(result).toEqual({
      files: syncedFiles,
      currentFileIndex: 0,
      activeFileId: 'b',
      currentEnv: 'prod'
    });
  });
});
