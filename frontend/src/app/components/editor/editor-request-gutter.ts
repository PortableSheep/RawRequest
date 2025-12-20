import { BlockInfo, EditorView, GutterMarker, ViewUpdate, gutter } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { DEPENDS_LINE_REGEX, LOAD_LINE_REGEX, METHOD_LINE_REGEX } from '../../utils/http-file-analysis';

class PlayGutterMarker extends GutterMarker {
  constructor(
    private onClick: (requestIndex: number) => void,
    private requestIndex: number
  ) {
    super();
  }

  override toDOM() {
    const button = document.createElement('button');
    button.innerHTML = '▶';
    button.className = 'gutter-play-btn';
    button.dataset['requestIndex'] = this.requestIndex.toString();
    button.title = 'Send request';
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      this.onClick(this.requestIndex);
    };
    return button;
  }
}

class ChainGutterMarker extends GutterMarker {
  override toDOM() {
    const icon = document.createElement('span');
    icon.innerHTML = '🔗';
    icon.className = 'gutter-chain-icon';
    icon.title = 'Chained request';
    return icon;
  }
}

class LightningGutterMarker extends GutterMarker {
  override toDOM() {
    const icon = document.createElement('span');
    icon.innerHTML = '⚡️';
    icon.className = 'gutter-lightning-icon';
    icon.title = 'Load test';
    return icon;
  }
}

export function createRequestGutter(onExecuteRequest: (requestIndex: number) => void): Extension {
  return gutter({
    class: 'cm-gutter-play',
    lineMarker: (view: EditorView, line: BlockInfo) => {
      const lineNo = view.state.doc.lineAt(line.from).number;
      const lineContent = view.state.doc.line(lineNo).text;
      const trimmedLine = lineContent.trimStart();

      const isRequestLine = (value: string) => METHOD_LINE_REGEX.test(value.trimStart());

      // Show play button on lines that define a request
      if (isRequestLine(lineContent)) {
        let requestIndex = 0;
        for (let i = 1; i < lineNo; i++) {
          const prevLine = view.state.doc.line(i).text;
          if (isRequestLine(prevLine)) {
            requestIndex++;
          }
        }
        return new PlayGutterMarker(onExecuteRequest, requestIndex);
      }

      if (DEPENDS_LINE_REGEX.test(trimmedLine)) {
        return new ChainGutterMarker();
      }

      if (LOAD_LINE_REGEX.test(trimmedLine)) {
        return new LightningGutterMarker();
      }

      return null;
    },

    lineMarkerChange: (update: ViewUpdate) => update.docChanged
  });
}
