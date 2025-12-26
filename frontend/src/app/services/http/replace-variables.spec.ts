import { replaceVariables } from './replace-variables';

describe('replace-variables', () => {
  it('replaces all occurrences of placeholders', () => {
    const text = 'Hello {{name}} and {{name}}!';
    expect(replaceVariables(text, { name: 'Ada' })).toBe('Hello Ada and Ada!');
  });

  it('leaves unknown placeholders intact', () => {
    const text = 'Hello {{name}} {{missing}}';
    expect(replaceVariables(text, { name: 'Ada' })).toBe('Hello Ada {{missing}}');
  });
});
