import type { FileTab } from '../../models/http.models';
import type { ParsedHttpFile } from '../parser.service';
import { computeSelectedEnvAfterParse } from './tab-selection';

export function deriveFileDisplayName(raw: string | undefined, fallback?: string): string | undefined {
  const trimmed = raw?.trim();
  if (trimmed) {
    return trimmed;
  }
  const fallbackTrimmed = fallback?.trim();
  return fallbackTrimmed || undefined;
}

export function buildNewFileTabFromParsed(args: {
  id: string;
  name: string;
  content: string;
  filePath?: string;
  parsed: ParsedHttpFile;
}): FileTab {
  const envNames = Object.keys(args.parsed.environments || {});
  return {
    id: args.id,
    name: args.name,
    content: args.content,
    requests: args.parsed.requests,
    environments: args.parsed.environments,
    variables: args.parsed.variables,
    responseData: {},
    groups: args.parsed.groups,
    selectedEnv: envNames[0] || '',
    displayName: deriveFileDisplayName(args.parsed.fileDisplayName, undefined),
    filePath: args.filePath
  };
}

export function buildUpdatedFileTabFromParsed(args: {
  previousFile: FileTab;
  content: string;
  parsed: ParsedHttpFile;
}): FileTab {
  const envNames = Object.keys(args.parsed.environments || {});
  const selectedEnv = computeSelectedEnvAfterParse(args.previousFile.selectedEnv || '', envNames);
  return {
    ...args.previousFile,
    content: args.content,
    requests: args.parsed.requests,
    environments: args.parsed.environments,
    variables: args.parsed.variables,
    groups: args.parsed.groups,
    selectedEnv,
    displayName: deriveFileDisplayName(args.parsed.fileDisplayName, undefined)
  };
}

export function buildExamplesTabFromParsed(args: {
  name: string;
  content: string;
  parsed: ParsedHttpFile;
  examplesId: string;
  defaultDisplayName: string;
}): FileTab {
  const envNames = Object.keys(args.parsed.environments || {});
  return {
    id: args.examplesId,
    name: args.name,
    content: args.content,
    requests: args.parsed.requests,
    environments: args.parsed.environments,
    variables: args.parsed.variables,
    responseData: {},
    groups: args.parsed.groups,
    selectedEnv: envNames[0] || '',
    displayName: deriveFileDisplayName(args.parsed.fileDisplayName, args.defaultDisplayName)
  };
}
