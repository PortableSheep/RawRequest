import { EditorState } from '@codemirror/state';
import { syntaxTree, LRLanguage, LanguageSupport } from '@codemirror/language';

import { parser as rawRequestHttpParser } from './rawrequest-http-parser';

const rawRequestHttpLanguage = LRLanguage.define({ parser: rawRequestHttpParser });
const rawRequestHttpSupport = new LanguageSupport(rawRequestHttpLanguage);

describe('rawrequest-http parser', () => {
  it('parses header keys with underscores as HeaderLine', () => {
    const doc = [
      'GET https://example.com',
      'header_one: value',
      'header-two: value',
      '',
      '{"ok":true}'
    ].join('\n');

    const state = EditorState.create({
      doc,
      extensions: [rawRequestHttpSupport]
    });

    const tree = syntaxTree(state);
    const header1 = state.doc.line(2);
    const header2 = state.doc.line(3);

    expect(tree.resolve(header1.from, 1).name).toBe('HeaderLine');
    expect(tree.resolve(header2.from, 1).name).toBe('HeaderLine');
  });
});
