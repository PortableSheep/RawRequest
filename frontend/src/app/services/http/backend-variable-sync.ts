export type SetVariableFn = (key: string, value: string) => Promise<void>;

export type BackendVariableSyncLogger = {
  warn?: (...args: any[]) => void;
};

export async function syncInitialVariablesToBackend(
  variables: { [key: string]: string } | undefined,
  setVariable: SetVariableFn,
  logger: BackendVariableSyncLogger = {}
): Promise<void> {
  try {
    await Promise.all(
      Object.entries(variables || {}).map(([key, value]) =>
        setVariable(key, String(value ?? ''))
      )
    );
  } catch (e) {
    logger.warn?.('[HTTP Service] Failed to sync initial variables to backend', e);
  }
}
