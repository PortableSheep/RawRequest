import { replaceVariables } from './replace-variables';

export type ReplaceSecretsFn = (text: string, env: string) => Promise<string>;

export function normalizeEnvName(env?: string): string {
  const trimmed = (env || '').trim();
  return trimmed.length ? trimmed : 'default';
}

export async function hydrateText(
  value: string,
  variables: { [key: string]: string },
  env: string,
  replaceSecrets: ReplaceSecretsFn
): Promise<string> {
  if (!value) {
    return value;
  }
  const withSecrets = await replaceSecrets(value, env);
  return replaceVariables(withSecrets, variables);
}

export async function hydrateTextSecretsOnly(
  value: string,
  env: string,
  replaceSecrets: ReplaceSecretsFn
): Promise<string> {
  if (!value) {
    return value;
  }
  return await replaceSecrets(value, env);
}

export async function hydrateHeadersSecretsOnly(
  headers: { [key: string]: string } | undefined,
  env: string,
  replaceSecrets: ReplaceSecretsFn
): Promise<{ [key: string]: string }> {
  const source = headers || {};
  const result: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(source)) {
    result[key] = await hydrateTextSecretsOnly(value, env, replaceSecrets);
  }
  return result;
}

export async function hydrateHeaders(
  headers: { [key: string]: string } | undefined,
  variables: { [key: string]: string },
  env: string,
  replaceSecrets: ReplaceSecretsFn
): Promise<{ [key: string]: string }> {
  const source = headers || {};
  const result: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(source)) {
    result[key] = await hydrateText(value, variables, env, replaceSecrets);
  }
  return result;
}
