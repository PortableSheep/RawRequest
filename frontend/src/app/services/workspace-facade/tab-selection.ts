export function deriveNextCurrentIndexAfterClose(
  currentFileIndex: number,
  removedIndex: number,
  nextFilesLength: number
): number {
  if (nextFilesLength <= 0) {
    return 0;
  }

  let nextCurrentIndex = currentFileIndex;
  if (nextCurrentIndex >= nextFilesLength) {
    nextCurrentIndex = nextFilesLength - 1;
  } else if (nextCurrentIndex > removedIndex) {
    nextCurrentIndex--;
  }

  return Math.max(0, Math.min(nextFilesLength - 1, nextCurrentIndex));
}

export function computeSelectedEnvAfterParse(previousSelectedEnv: string, envNames: string[]): string {
  let selectedEnv = previousSelectedEnv || '';

  if (selectedEnv && !envNames.includes(selectedEnv)) {
    selectedEnv = envNames[0] || '';
  } else if (!selectedEnv && envNames.length > 0) {
    selectedEnv = envNames[0];
  }

  return selectedEnv;
}
