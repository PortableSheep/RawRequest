import type { FileTab } from '../models/http.models';

export function generateFileId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeFileTab(file: FileTab): FileTab {
  const envNames = Object.keys(file.environments || {});
  let selectedEnv = file.selectedEnv ?? '';

  if (selectedEnv && !envNames.includes(selectedEnv)) {
    selectedEnv = envNames[0] || '';
  } else if (!selectedEnv && envNames.length > 0) {
    selectedEnv = envNames[0];
  } else if (!envNames.length) {
    selectedEnv = '';
  }

  const id = file.filePath && file.filePath.length
    ? file.filePath
    : (file.id && file.id.length ? file.id : generateFileId());

  const displayName = file.displayName?.trim();

  return {
    ...file,
    id,
    selectedEnv,
    displayName: displayName || undefined
  };
}
