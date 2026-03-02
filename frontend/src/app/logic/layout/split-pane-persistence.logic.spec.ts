import { readSplitWidthPxFromStorage, writeSplitWidthPxToStorage } from './split-pane-persistence.logic';

describe('split-pane-persistence.logic', () => {
  it('reads split width using parseSplitWidthPx rules', () => {
    const storage = {
      getItem: vi.fn().mockReturnValue('320'),
      setItem: vi.fn()
    };

    expect(readSplitWidthPxFromStorage(storage as any, 'k')).toBe(320);
  });

  it('returns null when storage.getItem throws', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('boom');
      }),
      setItem: vi.fn()
    };

    expect(readSplitWidthPxFromStorage(storage as any, 'k')).toBeNull();
  });

  it('writes width as string, swallowing storage errors', () => {
    const okStorage = { getItem: vi.fn(), setItem: vi.fn() };
    writeSplitWidthPxToStorage(okStorage as any, 'k', 444);
    expect(okStorage.setItem).toHaveBeenCalledWith('k', '444');

    const throwingStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new Error('nope');
      })
    };
    expect(() => writeSplitWidthPxToStorage(throwingStorage as any, 'k', 1)).not.toThrow();
  });
});
