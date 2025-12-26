import { createNewUntitledTab } from './tab-factories';
import { deriveNextCurrentIndexAfterClose, computeSelectedEnvAfterParse } from './tab-selection';
import { reorderTabsPure } from './reorder-tabs';

describe('workspace-facade helpers', () => {
  it('createNewUntitledTab uses provided tab number', () => {
    const tab = createNewUntitledTab(() => 'id1', 3);
    expect(tab.id).toBe('id1');
    expect(tab.name).toBe('Untitled-3.http');
  });

  it('deriveNextCurrentIndexAfterClose clamps and shifts', () => {
    expect(deriveNextCurrentIndexAfterClose(2, 1, 2)).toBe(1); // current > removed, shift left
    expect(deriveNextCurrentIndexAfterClose(5, 0, 2)).toBe(1); // clamp to last
    expect(deriveNextCurrentIndexAfterClose(0, 0, 0)).toBe(0);
  });

  it('computeSelectedEnvAfterParse keeps when valid, otherwise picks first', () => {
    expect(computeSelectedEnvAfterParse('dev', ['dev', 'prod'])).toBe('dev');
    expect(computeSelectedEnvAfterParse('gone', ['dev'])).toBe('dev');
    expect(computeSelectedEnvAfterParse('', ['dev'])).toBe('dev');
    expect(computeSelectedEnvAfterParse('', [])).toBe('');
  });

  it('reorderTabsPure keeps active tab selected by id', () => {
    const files: any[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const res = reorderTabsPure(files as any, 1, 0, 2); // move a to end
    expect(res.files.map(f => f.id)).toEqual(['b', 'c', 'a']);
    expect(res.activeFileId).toBe('b');
    expect(res.currentFileIndex).toBe(0);
  });
});
