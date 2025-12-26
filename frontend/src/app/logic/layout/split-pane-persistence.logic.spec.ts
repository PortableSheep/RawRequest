import { readSplitWidthPxFromStorage, writeSplitWidthPxToStorage } from './split-pane-persistence.logic';

describe('split-pane-persistence.logic', () => {
  it('reads split width using parseSplitWidthPx rules', () => {
    const storage = {
      getItem: jest.fn().mockReturnValue('320'),
      setItem: jest.fn()
    };

    expect(readSplitWidthPxFromStorage(storage as any, 'k')).toBe(320);
  });

  it('returns null when storage.getItem throws', () => {
    const storage = {
      getItem: jest.fn(() => {
        throw new Error('boom');
      }),
      setItem: jest.fn()
    };

    expect(readSplitWidthPxFromStorage(storage as any, 'k')).toBeNull();
  });

  it('writes width as string, swallowing storage errors', () => {
    const okStorage = { getItem: jest.fn(), setItem: jest.fn() };
    writeSplitWidthPxToStorage(okStorage as any, 'k', 444);
    expect(okStorage.setItem).toHaveBeenCalledWith('k', '444');

    const throwingStorage = {
      getItem: jest.fn(),
      setItem: jest.fn(() => {
        throw new Error('nope');
      })
    };
    expect(() => writeSplitWidthPxToStorage(throwingStorage as any, 'k', 1)).not.toThrow();
  });
});
