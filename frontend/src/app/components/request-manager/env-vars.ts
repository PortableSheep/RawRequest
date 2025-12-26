import type { FileTab } from '../../models/http.models';

export function getActiveEnvNameForFile(file: FileTab | undefined, currentEnv: string): string {
  if (file?.selectedEnv && file.selectedEnv.length) {
    return file.selectedEnv;
  }

  const env = currentEnv;
  return env && env.length ? env : 'default';
}

export function getCombinedVariablesForFile(
  file: FileTab | undefined,
  currentEnv: string
): { [key: string]: string } {
  if (!file) {
    return {};
  }

  const variables: { [key: string]: string } = { ...file.variables };
  const activeEnvName = getActiveEnvNameForFile(file, currentEnv);
  const envVars = (activeEnvName && file.environments) ? (file.environments[activeEnvName] || {}) : {};
  Object.assign(variables, envVars);
  return variables;
}
