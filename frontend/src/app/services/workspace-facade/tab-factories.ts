import type { FileTab } from '../../models/http.models';

export type CreateEmptyTabInput = {
  id: string;
  name: string;
  content?: string;
  displayName?: string;
  filePath?: string;
};

export function createEmptyTab(input: CreateEmptyTabInput): FileTab {
  return {
    id: input.id,
    name: input.name,
    content: input.content ?? '',
    requests: [],
    environments: {},
    variables: {},
    responseData: {},
    groups: [],
    selectedEnv: '',
    displayName: input.displayName,
    filePath: input.filePath
  } as FileTab;
}

export function createNewUntitledTab(generateId: () => string, tabNumber: number): FileTab {
  return createEmptyTab({
    id: generateId(),
    name: `Untitled-${tabNumber}.http`,
    content: ''
  });
}
