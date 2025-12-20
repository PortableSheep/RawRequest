import { keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import { foldKeymap } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';

export interface EditorKeymapOptions {
  getRequestIndexAtPos: (state: EditorState, pos: number) => number | null;
  onExecuteRequest: (requestIndex: number) => void;
}

export function createEditorKeymap(opts: EditorKeymapOptions): Extension {
  return keymap.of([
    {
      key: 'Tab',
      run: ({ state, dispatch }) => {
        const selection = state.selection.main;
        const doc = state.doc;

        if (!selection.empty) {
          const startLine = doc.lineAt(selection.from).number;
          const endLine = doc.lineAt(selection.to).number;

          const changes: Array<{ from: number; insert: string }> = [];
          for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
            const line = doc.line(lineNum);
            changes.push({
              from: line.from,
              insert: '\t'
            });
          }

          dispatch(
            state.update({
              changes,
              selection: {
                anchor: selection.from + 1,
                head: selection.to + (endLine - startLine + 1)
              }
            })
          );
          return true;
        }

        dispatch(state.update(state.replaceSelection('\t')));
        return true;
      }
    },
    {
      key: 'Shift-Tab',
      run: ({ state, dispatch }) => {
        const selection = state.selection.main;
        const doc = state.doc;
        const startLine = doc.lineAt(selection.from).number;
        const endLine = doc.lineAt(selection.to).number;
        const linesToProcess = selection.empty
          ? [startLine]
          : Array.from({ length: endLine - startLine + 1 }, (_, i) => startLine + i);

        const changes: Array<{ from: number; to: number; insert: string }> = [];
        let totalRemoved = 0;

        for (const lineNum of linesToProcess) {
          const line = doc.line(lineNum);
          const lineText = line.text;

          let indentToRemove = '';
          if (lineText.startsWith('\t')) {
            indentToRemove = '\t';
          } else if (lineText.startsWith('  ')) {
            indentToRemove = '  ';
          } else if (lineText.startsWith('    ')) {
            indentToRemove = '    ';
          }

          if (indentToRemove) {
            changes.push({
              from: line.from,
              to: line.from + indentToRemove.length,
              insert: ''
            });
            totalRemoved += indentToRemove.length;
          }
        }

        if (changes.length > 0) {
          let newAnchor = selection.from;
          let newHead = selection.to;

          if (selection.empty) {
            newAnchor = Math.max(0, selection.from - totalRemoved / linesToProcess.length);
            newHead = newAnchor;
          } else {
            newAnchor = Math.max(
              0,
              selection.from - (selection.from === doc.line(startLine).from ? totalRemoved / linesToProcess.length : 0)
            );
            newHead = Math.max(0, selection.to - totalRemoved);
          }

          dispatch(
            state.update({
              changes,
              selection: { anchor: newAnchor, head: newHead }
            })
          );
          return true;
        }

        return true;
      }
    },
    {
      key: 'Mod-Enter',
      run: view => {
        const requestIndex = opts.getRequestIndexAtPos(view.state, view.state.selection.main.head);
        if (requestIndex === null) return false;
        opts.onExecuteRequest(requestIndex);
        return true;
      }
    },
    ...searchKeymap,
    ...foldKeymap
  ]);
}
